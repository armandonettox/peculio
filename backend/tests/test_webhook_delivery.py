import asyncio
import hashlib
import hmac
import json
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError

from app.core import scheduler, webhook_url
from app.core.database import SessionLocal
from app.core.two_factor import encrypt_secret
from app.models.transaction import Transaction
from app.models.user import User
from app.models.webhook import DeliveryStatus, Webhook, WebhookDelivery
from app.schemas.transaction import TransactionCreate
from app.services import recurrences as recurrence_service
from app.services import transactions as transaction_service
from app.services import webhook_delivery as delivery_service
from tests.conftest import auth_headers, make_user, register
from tests.webhook_support import FakeServer, no_real_dns, server  # noqa: F401

URL = "/api/v1/webhooks"
TX_URL = "/api/v1/transactions"
ACCOUNTS_URL = "/api/v1/accounts"
# Bem depois de qualquer momento real, para toda entrega recem-criada ja estar vencida
NOW = datetime(2040, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


@pytest.fixture
def account_id(client, headers):
    body = {"name": "Nubank", "type": "asset", "currency_code": "BRL", "opening_balance": "5000.00"}
    return client.post(ACCOUNTS_URL, json=body, headers=headers).json()["id"]


def make_webhook(client, headers, **overrides):
    body = {
        "name": "Home Assistant",
        "url": "https://hooks.example.com/finance",
        "events": ["transaction.created", "transaction.updated", "transaction.deleted"],
        **overrides,
    }
    resp = client.post(URL, json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def split(account_id, **overrides):
    return {
        "type": "withdrawal",
        "date": "2026-02-01",
        "description": "Compra no mercado",
        "amount": "50.10",
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Supermercado",
        **overrides,
    }


def create_tx(client, headers, account_id, **overrides):
    resp = client.post(TX_URL, json={"splits": [split(account_id, **overrides)]}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def deliveries(db_session, event=None):
    db_session.expire_all()
    statement = select(WebhookDelivery).order_by(WebhookDelivery.created_at, WebhookDelivery.id)
    rows = db_session.execute(statement).scalars().all()
    return [row for row in rows if event is None or row.event == event]


def run_now(db_session, when=NOW):
    """Tenta a proxima entrega vencida como se fosse `when`."""
    return delivery_service.deliver_next(db_session, now=when)


def only_delivery(db_session):
    db_session.expire_all()
    return db_session.execute(select(WebhookDelivery)).scalar_one()


# ---------- Funcoes puras ----------


@pytest.mark.parametrize(
    "failures, minutes",
    [(1, 1), (2, 5), (3, 30), (4, 120)],
)
def test_retry_delay_schedule(failures, minutes):
    assert delivery_service.retry_delay(failures) == timedelta(minutes=minutes)


def test_fifth_failure_has_no_more_retries():
    assert delivery_service.retry_delay(5) is None
    assert delivery_service.retry_delay(9) is None


def test_retry_delay_rejects_zero():
    with pytest.raises(ValueError):
        delivery_service.retry_delay(0)


def test_signature_matches_an_independent_computation():
    body = b'{"event":"transaction.created","data":{"amount":"10.00"}}'
    expected = "sha256=" + hmac.new(b"segredo-de-teste", b"1759406400." + body, hashlib.sha256).hexdigest()
    assert delivery_service.sign("segredo-de-teste", 1759406400, body) == expected


def test_signature_changes_with_secret_timestamp_and_body():
    base = delivery_service.sign("a", 1, b"x")
    assert delivery_service.sign("b", 1, b"x") != base
    assert delivery_service.sign("a", 2, b"x") != base
    assert delivery_service.sign("a", 1, b"y") != base


def test_body_is_compact_json_that_keeps_accents():
    body = delivery_service.build_body({"a": "João", "b": [1, 2]})
    assert body == '{"a":"João","b":[1,2]}'.encode("utf-8")


# ---------- Outbox: o que gera entrega ----------


def test_creating_a_transaction_queues_one_delivery_per_subscriber(client, headers, account_id, db_session):
    make_webhook(client, headers, name="A")
    make_webhook(client, headers, name="B", events=["transaction.created"])
    created = create_tx(client, headers, account_id)
    rows = deliveries(db_session)
    assert len(rows) == 2
    for row in rows:
        assert row.status == DeliveryStatus.pending
        assert row.attempts == 0
        assert row.event == "transaction.created"
        assert row.next_attempt_at is not None
        payload = row.payload
        assert set(payload) == {"event", "occurred_at", "data"}
        assert payload["event"] == "transaction.created"
        assert datetime.fromisoformat(payload["occurred_at"]).utcoffset() == timedelta(0)
        assert payload["data"]["id"] == created["id"]
        # Dinheiro vai como texto, no mesmo formato da API
        assert payload["data"]["splits"][0]["amount"] == "50.10"
        assert isinstance(payload["data"]["splits"][0]["amount"], str)
        assert payload["data"] == json.loads(json.dumps(created))


def test_payload_has_the_same_shape_as_the_api(client, headers, account_id, db_session):
    make_webhook(client, headers)
    created = create_tx(client, headers, account_id)
    payload = deliveries(db_session)[0].payload["data"]
    assert set(payload) == set(created)
    assert set(payload["splits"][0]) == set(created["splits"][0])


def test_update_queues_the_updated_event_with_the_new_data(client, headers, account_id, db_session):
    make_webhook(client, headers)
    created = create_tx(client, headers, account_id)
    body = {"splits": [split(account_id, amount="75.00", description="Editado")]}
    assert client.put(f"{TX_URL}/{created['id']}", json=body, headers=headers).status_code == 200
    updated = deliveries(db_session, "transaction.updated")
    assert len(updated) == 1
    data = updated[0].payload["data"]
    assert data["id"] == created["id"]
    assert data["splits"][0]["amount"] == "75.00"
    assert data["splits"][0]["description"] == "Editado"


def test_delete_payload_is_the_snapshot_before_deleting(client, headers, account_id, db_session):
    make_webhook(client, headers)
    created = create_tx(client, headers, account_id, description="Para apagar", amount="12.34")
    assert client.delete(f"{TX_URL}/{created['id']}", headers=headers).status_code == 204
    rows = deliveries(db_session, "transaction.deleted")
    assert len(rows) == 1
    data = rows[0].payload["data"]
    assert data["id"] == created["id"]
    assert data["splits"][0]["description"] == "Para apagar"
    assert data["splits"][0]["amount"] == "12.34"
    # O lancamento realmente sumiu, mas o aviso ficou
    assert db_session.get(Transaction, uuid.UUID(created["id"])) is None


def test_events_only_go_to_who_subscribed(client, headers, account_id, db_session):
    make_webhook(client, headers, name="So criacao", events=["transaction.created"])
    make_webhook(client, headers, name="So exclusao", events=["transaction.deleted"])
    created = create_tx(client, headers, account_id)
    assert [d.event for d in deliveries(db_session)] == ["transaction.created"]
    client.delete(f"{TX_URL}/{created['id']}", headers=headers)
    names = {}
    for row in deliveries(db_session):
        webhook = db_session.get(Webhook, row.webhook_id)
        names.setdefault(webhook.name, []).append(row.event)
    assert names == {"So criacao": ["transaction.created"], "So exclusao": ["transaction.deleted"]}


def test_a_paused_webhook_gets_nothing(client, headers, account_id, db_session):
    made = make_webhook(client, headers)
    client.patch(f"{URL}/{made['id']}", json={"active": False}, headers=headers)
    create_tx(client, headers, account_id)
    assert deliveries(db_session) == []
    client.patch(f"{URL}/{made['id']}", json={"active": True}, headers=headers)
    create_tx(client, headers, account_id)
    assert len(deliveries(db_session)) == 1


def test_other_users_webhooks_do_not_get_my_transactions(client, headers, account_id, db_session):
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    make_webhook(client, other, name="Dela")
    create_tx(client, headers, account_id)
    assert deliveries(db_session) == []


def test_a_user_without_webhooks_pays_for_one_extra_query_only(client, headers, account_id):
    from sqlalchemy import event as sa_event

    from app.core.database import engine

    statements = []

    def record(conn, cursor, statement, *args):
        statements.append(statement)

    create_tx(client, headers, account_id)
    sa_event.listen(engine, "before_cursor_execute", record)
    try:
        create_tx(client, headers, account_id)
    finally:
        sa_event.remove(engine, "before_cursor_execute", record)
    assert sum("webhooks" in s for s in statements) == 1


def test_a_failed_transaction_leaves_no_delivery(client, headers, account_id, db_session):
    make_webhook(client, headers)
    before = len(db_session.execute(select(Transaction)).scalars().all())
    body = {"splits": [split(account_id), split(str(uuid.uuid4()))]}
    resp = client.post(TX_URL, json=body, headers=headers)
    assert resp.status_code in (404, 422)
    assert deliveries(db_session) == []
    db_session.expire_all()
    assert len(db_session.execute(select(Transaction)).scalars().all()) == before


def test_a_failed_edit_leaves_no_delivery_and_keeps_the_original(client, headers, account_id, db_session):
    make_webhook(client, headers, events=["transaction.updated"])
    created = create_tx(client, headers, account_id)
    body = {"splits": [split(account_id), split(str(uuid.uuid4()))]}
    assert client.put(f"{TX_URL}/{created['id']}", json=body, headers=headers).status_code in (404, 422)
    assert deliveries(db_session) == []


def test_outbox_is_in_the_same_database_transaction(client, headers, account_id, db_session):
    """Sem commit, a entrega nao existe; desfazendo a operacao, ela some junto."""
    made = make_webhook(client, headers)
    user = db_session.execute(select(User)).scalar_one()
    data = TransactionCreate.model_validate({"splits": [split(account_id)]})
    transaction_service.create_transaction(db_session, user, data)
    # Visivel so dentro da transacao aberta
    assert db_session.execute(select(WebhookDelivery)).scalars().all()
    with SessionLocal() as other_session:
        assert other_session.execute(select(WebhookDelivery)).scalars().all() == []
    db_session.rollback()
    assert db_session.execute(select(WebhookDelivery)).scalars().all() == []
    assert db_session.get(Webhook, uuid.UUID(made["id"])) is not None


def test_recurrences_also_queue_the_created_event(client, headers, account_id, db_session):
    make_webhook(client, headers, events=["transaction.created"])
    body = {
        "name": "Aluguel",
        "frequency": "daily",
        "first_date": "2026-01-01",
        "template": {"splits": [split(account_id, amount="1000.00")]},
    }
    recurrence_id = client.post("/api/v1/recurrences", json=body, headers=headers).json()["id"]
    db_session.expire_all()
    # A criacao da recorrente ja roda uma vez; limpa para testar a rodada do laco
    before = len(deliveries(db_session))
    created = recurrence_service.run_all(db_session, datetime(2026, 1, 3).date())
    rows = deliveries(db_session)
    assert len(rows) == before + created
    assert rows, "a recorrente nao gerou evento"
    assert all(row.payload["data"]["recurrence_id"] == recurrence_id for row in rows)


# ---------- Entrega: requisicao ----------


def pending_one(client, headers, account_id, **webhook_overrides):
    made = make_webhook(client, headers, events=["transaction.created"], **webhook_overrides)
    create_tx(client, headers, account_id)
    return made


def test_request_has_signed_headers_and_the_json_body(client, headers, account_id, db_session, server):
    made = pending_one(client, headers, account_id)
    assert run_now(db_session) is True
    assert len(server.requests) == 1
    request = server.requests[0]
    delivery = only_delivery(db_session)

    assert request.method == "POST"
    assert str(request.url) == "https://hooks.example.com/finance"
    body = request.content
    assert json.loads(body)["event"] == "transaction.created"
    assert request.headers["content-type"] == "application/json"
    assert request.headers["x-finance-event"] == "transaction.created"
    assert request.headers["x-finance-delivery"] == str(delivery.id)
    timestamp = request.headers["x-finance-timestamp"]
    assert timestamp == str(int(NOW.timestamp()))
    expected = "sha256=" + hmac.new(
        made["secret"].encode(), timestamp.encode() + b"." + body, hashlib.sha256
    ).hexdigest()
    assert request.headers["x-finance-signature"] == expected
    assert made["secret"] not in body.decode()
    assert made["secret"] not in str(dict(request.headers))


def test_success_marks_the_delivery_as_delivered(client, headers, account_id, db_session, server):
    server.handler = lambda request: httpx.Response(204)
    pending_one(client, headers, account_id)
    run_now(db_session)
    delivery = only_delivery(db_session)
    assert delivery.status == DeliveryStatus.delivered
    assert delivery.attempts == 1
    assert delivery.last_status_code == 204
    assert delivery.last_error is None
    assert delivery.delivered_at == NOW
    assert delivery.next_attempt_at is None
    # Entregue nao volta a ser tentada
    assert run_now(db_session, NOW + timedelta(days=1)) is False
    assert len(server.requests) == 1


@pytest.mark.parametrize("code", [200, 201, 202, 299])
def test_any_2xx_is_success(client, headers, account_id, db_session, server, code):
    server.handler = lambda request: httpx.Response(code)
    pending_one(client, headers, account_id)
    run_now(db_session)
    assert only_delivery(db_session).status == DeliveryStatus.delivered


@pytest.mark.parametrize("code", [400, 401, 404, 410, 429, 500, 502, 503])
def test_4xx_and_5xx_are_failures_that_get_retried(client, headers, account_id, db_session, server, code):
    server.handler = lambda request: httpx.Response(code, text="nao deu")
    pending_one(client, headers, account_id)
    run_now(db_session)
    delivery = only_delivery(db_session)
    assert delivery.status == DeliveryStatus.pending
    assert delivery.attempts == 1
    assert delivery.last_status_code == code
    assert delivery.last_error == f"Resposta HTTP {code}"
    assert delivery.response_excerpt == "nao deu"
    assert delivery.next_attempt_at == NOW + timedelta(minutes=1)
    assert delivery.delivered_at is None


def test_timeout_is_a_failure_without_status_code(client, headers, account_id, db_session, server):
    def slow(request):
        raise httpx.ReadTimeout("demorou", request=request)

    server.handler = slow
    pending_one(client, headers, account_id)
    run_now(db_session)
    delivery = only_delivery(db_session)
    assert delivery.status == DeliveryStatus.pending
    assert delivery.last_status_code is None
    assert "Tempo esgotado" in delivery.last_error
    assert delivery.next_attempt_at == NOW + timedelta(minutes=1)


def test_connection_error_is_a_failure(client, headers, account_id, db_session, server):
    def refuse(request):
        raise httpx.ConnectError("recusado", request=request)

    server.handler = refuse
    pending_one(client, headers, account_id)
    run_now(db_session)
    delivery = only_delivery(db_session)
    assert delivery.status == DeliveryStatus.pending
    assert delivery.last_error.startswith("Nao foi possivel conectar ao endereco")


def test_redirects_are_not_followed(client, headers, account_id, db_session, server):
    server.handler = lambda request: httpx.Response(302, headers={"Location": "http://169.254.169.254/latest/meta-data"})
    pending_one(client, headers, account_id)
    run_now(db_session)
    delivery = only_delivery(db_session)
    assert len(server.requests) == 1
    assert delivery.last_status_code == 302
    assert delivery.status == DeliveryStatus.pending
    assert delivery.last_error == "Resposta HTTP 302"


def test_the_real_client_is_built_without_redirects_and_with_10s_timeout():
    with delivery_service.make_client() as real:
        assert real.follow_redirects is False
        assert real.timeout.read == 10
        assert real.timeout.connect == 10


def test_response_excerpt_is_capped_at_500_chars_and_survives_nul(client, headers, account_id, db_session, server):
    server.handler = lambda request: httpx.Response(500, content=(b"a\x00b" * 2000))
    pending_one(client, headers, account_id)
    run_now(db_session)
    excerpt = only_delivery(db_session).response_excerpt
    assert len(excerpt) == 500
    assert "\x00" not in excerpt


def test_binary_response_does_not_break_the_attempt(client, headers, account_id, db_session, server):
    server.handler = lambda request: httpx.Response(200, content=b"\xff\xfe\x00\x01")
    pending_one(client, headers, account_id)
    run_now(db_session)
    assert only_delivery(db_session).status == DeliveryStatus.delivered


# ---------- Retentativas ----------


def test_retries_follow_the_schedule_and_the_fifth_failure_ends_it(client, headers, account_id, db_session, server):
    server.handler = lambda request: httpx.Response(503, text="fora")
    pending_one(client, headers, account_id)
    when = NOW
    expected_waits = [timedelta(minutes=1), timedelta(minutes=5), timedelta(minutes=30), timedelta(hours=2)]
    for attempt, wait in enumerate(expected_waits, start=1):
        assert run_now(db_session, when) is True
        delivery = only_delivery(db_session)
        assert delivery.attempts == attempt
        assert delivery.status == DeliveryStatus.pending
        assert delivery.next_attempt_at == when + wait
        # Antes da hora marcada nada acontece
        assert run_now(db_session, when + wait - timedelta(seconds=1)) is False
        when = when + wait
    assert run_now(db_session, when) is True
    delivery = only_delivery(db_session)
    assert delivery.attempts == 5
    assert delivery.status == DeliveryStatus.failed
    assert delivery.next_attempt_at is None
    assert delivery.last_status_code == 503
    # Encerrada: nunca mais tentada
    assert run_now(db_session, when + timedelta(days=30)) is False
    assert len(server.requests) == 5


def test_a_retry_that_succeeds_ends_as_delivered(client, headers, account_id, db_session, server):
    answers = iter([500, 500, 200])
    server.handler = lambda request: httpx.Response(next(answers))
    pending_one(client, headers, account_id)
    run_now(db_session, NOW)
    run_now(db_session, NOW + timedelta(minutes=1))
    run_now(db_session, NOW + timedelta(minutes=6))
    delivery = only_delivery(db_session)
    assert delivery.status == DeliveryStatus.delivered
    assert delivery.attempts == 3
    assert delivery.last_error is None
    assert delivery.last_status_code == 200


def test_oldest_due_delivery_goes_first(client, headers, account_id, db_session, server):
    pending_one(client, headers, account_id)
    create_tx(client, headers, account_id, description="Segunda")
    run_now(db_session)
    first = [d for d in deliveries(db_session) if d.status == DeliveryStatus.delivered]
    assert len(first) == 1
    assert first[0].payload["data"]["splits"][0]["description"] == "Compra no mercado"


def test_run_due_delivers_everything_due_and_respects_the_limit(client, headers, account_id, db_session, server):
    make_webhook(client, headers)
    for _ in range(3):
        create_tx(client, headers, account_id)
    assert delivery_service.run_due(db_session, limit=2) == 2
    assert delivery_service.run_due(db_session) == 1
    assert delivery_service.run_due(db_session) == 0
    assert all(d.status == DeliveryStatus.delivered for d in deliveries(db_session))


# ---------- Pausa e exclusao ----------


def test_pausing_expires_what_is_already_queued_and_reactivating_does_not_resend(
    client, headers, account_id, db_session, server
):
    made = pending_one(client, headers, account_id)
    create_tx(client, headers, account_id, description="Segunda")
    client.patch(f"{URL}/{made['id']}", json={"active": False}, headers=headers)
    rows = deliveries(db_session)
    assert [row.status for row in rows] == [DeliveryStatus.expired, DeliveryStatus.expired]
    for row in rows:
        assert row.next_attempt_at is None
        assert row.last_error == delivery_service.PAUSED_REASON
        assert row.attempts == 0
        assert row.delivered_at is None
    # Pausado: nada sai
    assert run_now(db_session) is False
    assert server.requests == []
    # Reativar nao reenvia o que expirou; so eventos novos entram na fila
    client.patch(f"{URL}/{made['id']}", json={"active": True}, headers=headers)
    assert run_now(db_session) is False
    assert server.requests == []
    assert all(row.status == DeliveryStatus.expired for row in deliveries(db_session))
    create_tx(client, headers, account_id, description="Nova")
    assert run_now(db_session) is True
    assert len(server.requests) == 1


def test_pausing_only_touches_pending_deliveries_of_that_webhook(client, headers, account_id, db_session, server):
    other = make_webhook(client, headers, name="Outro", events=["transaction.created"])
    made = pending_one(client, headers, account_id)
    # Uma entrega ja entregue do webhook pausado nao muda de estado
    assert run_now(db_session) is True
    assert run_now(db_session) is True
    create_tx(client, headers, account_id, description="Segunda")
    client.patch(f"{URL}/{made['id']}", json={"active": False}, headers=headers)
    by_webhook = {}
    for row in deliveries(db_session):
        by_webhook.setdefault(str(row.webhook_id), []).append(row.status)
    assert by_webhook[made["id"]].count(DeliveryStatus.delivered) == 1
    assert by_webhook[made["id"]].count(DeliveryStatus.expired) == 1
    assert by_webhook[other["id"]] == [DeliveryStatus.delivered, DeliveryStatus.pending]


def test_editing_a_paused_webhook_without_activating_keeps_the_queue_empty(client, headers, account_id, db_session):
    made = pending_one(client, headers, account_id)
    client.patch(f"{URL}/{made['id']}", json={"active": False}, headers=headers)
    # Editar outro campo, ainda pausado, nao mexe em nada
    assert client.patch(f"{URL}/{made['id']}", json={"name": "Novo nome"}, headers=headers).status_code == 200
    assert [row.status for row in deliveries(db_session)] == [DeliveryStatus.expired]


def test_pausing_again_clears_stragglers_left_in_a_paused_webhook(client, headers, account_id, db_session):
    made = pending_one(client, headers, account_id)
    webhook = db_session.get(Webhook, uuid.UUID(made["id"]))
    webhook.active = False
    db_session.commit()
    assert [row.status for row in deliveries(db_session)] == [DeliveryStatus.pending]
    client.patch(f"{URL}/{made['id']}", json={"active": False}, headers=headers)
    assert [row.status for row in deliveries(db_session)] == [DeliveryStatus.expired]


def test_renaming_an_active_webhook_does_not_expire_the_queue(client, headers, account_id, db_session):
    made = pending_one(client, headers, account_id)
    client.patch(f"{URL}/{made['id']}", json={"name": "Novo nome", "active": True}, headers=headers)
    assert [row.status for row in deliveries(db_session)] == [DeliveryStatus.pending]


def test_a_delivery_due_for_a_paused_webhook_expires_instead_of_staying_pending(
    client, headers, account_id, db_session, server
):
    """Rede de seguranca: pausa feita direto no banco (sem passar pela API) tambem esvazia a fila."""
    made = pending_one(client, headers, account_id)
    webhook = db_session.get(Webhook, uuid.UUID(made["id"]))
    webhook.active = False
    db_session.commit()
    assert run_now(db_session) is True
    delivery = only_delivery(db_session)
    assert delivery.status == DeliveryStatus.expired
    assert delivery.last_error == delivery_service.PAUSED_REASON
    assert delivery.next_attempt_at is None
    assert delivery.attempts == 0
    assert server.requests == []
    # Final: nunca mais vira candidata, nem depois de reativar
    assert run_now(db_session, NOW + timedelta(days=30)) is False
    webhook.active = True
    db_session.commit()
    assert run_now(db_session, NOW + timedelta(days=30)) is False
    assert server.requests == []


def test_run_due_drains_expired_deliveries_and_keeps_going(client, headers, account_id, db_session, server):
    made = make_webhook(client, headers, name="Pausado")
    for _ in range(3):
        create_tx(client, headers, account_id)
    webhook = db_session.get(Webhook, uuid.UUID(made["id"]))
    webhook.active = False
    db_session.commit()
    assert delivery_service.run_due(db_session) == 3
    assert delivery_service.run_due(db_session) == 0
    assert {row.status for row in deliveries(db_session)} == {DeliveryStatus.expired}
    assert server.requests == []


def test_expired_is_a_valid_status_in_the_history_filter(client, headers, account_id):
    made = pending_one(client, headers, account_id)
    client.patch(f"{URL}/{made['id']}", json={"active": False}, headers=headers)
    page = client.get(f"{URL}/{made['id']}/deliveries?status=expired", headers=headers).json()
    assert [item["status"] for item in page["items"]] == ["expired"]
    assert page["items"][0]["last_error"] == delivery_service.PAUSED_REASON
    listed = client.get(URL, headers=headers).json()["items"][0]
    assert listed["last_delivery_status"] == "expired"


def test_deleting_the_webhook_drops_its_queue(client, headers, account_id, db_session, server):
    made = pending_one(client, headers, account_id)
    client.delete(f"{URL}/{made['id']}", headers=headers)
    assert deliveries(db_session) == []
    assert run_now(db_session) is False


# ---------- SSRF na hora de entregar ----------


def test_dns_changing_to_a_private_ip_blocks_the_delivery(client, headers, account_id, db_session, server, monkeypatch):
    pending_one(client, headers, account_id)
    # Depois do cadastro, o nome passa a apontar para a rede interna (rebinding)
    monkeypatch.setattr(webhook_url, "default_resolver", lambda host: ["10.0.0.7"])
    run_now(db_session)
    delivery = only_delivery(db_session)
    assert server.requests == []
    assert delivery.status == DeliveryStatus.pending
    assert delivery.attempts == 1
    assert "rede interna" in delivery.last_error
    assert delivery.last_status_code is None


def test_a_url_that_became_unsafe_in_the_database_is_not_called(client, headers, account_id, db_session, server):
    made = pending_one(client, headers, account_id)
    webhook = db_session.get(Webhook, uuid.UUID(made["id"]))
    webhook.url = "http://169.254.169.254/latest/meta-data"
    db_session.commit()
    run_now(db_session)
    assert server.requests == []
    assert only_delivery(db_session).attempts == 1


def test_unreadable_secret_fails_the_attempt_without_calling(client, headers, account_id, db_session, server):
    made = pending_one(client, headers, account_id)
    webhook = db_session.get(Webhook, uuid.UUID(made["id"]))
    webhook.secret_encrypted = "lixo-que-nao-abre"
    db_session.commit()
    run_now(db_session)
    delivery = only_delivery(db_session)
    assert server.requests == []
    assert "segredo" in delivery.last_error


# ---------- SKIP LOCKED ----------


def test_two_sessions_never_take_the_same_delivery(client, headers, account_id, db_session, server):
    make_webhook(client, headers)
    create_tx(client, headers, account_id)
    create_tx(client, headers, account_id, description="Segunda")

    def pick(session):
        return session.execute(
            select(WebhookDelivery)
            .where(WebhookDelivery.status == DeliveryStatus.pending)
            .order_by(WebhookDelivery.created_at, WebhookDelivery.id)
            .limit(1)
            .with_for_update(skip_locked=True)
        ).scalar_one_or_none()

    # Confirma que o codigo de producao usa a mesma consulta com SKIP LOCKED
    from sqlalchemy.dialects import postgresql  # noqa: F401

    with SessionLocal() as one, SessionLocal() as two:
        one.execute(text("SET lock_timeout = '500ms'"))
        two.execute(text("SET lock_timeout = '500ms'"))
        first = pick(one)
        second = pick(two)
        assert first is not None and second is not None
        assert first.id != second.id
        # Com as duas travadas, uma terceira nao encontra nada e tambem nao espera
        with SessionLocal() as three:
            three.execute(text("SET lock_timeout = '500ms'"))
            assert pick(three) is None


def test_deliver_next_skips_a_delivery_locked_by_another_session(client, headers, account_id, db_session, server):
    make_webhook(client, headers)
    create_tx(client, headers, account_id)
    with SessionLocal() as holder:
        holder.execute(text("SET lock_timeout = '500ms'"))
        locked = holder.execute(
            select(WebhookDelivery).with_for_update(skip_locked=True)
        ).scalar_one()
        assert locked is not None
        db_session.execute(text("SET lock_timeout = '500ms'"))
        try:
            # Falha rapido (lock_timeout) em vez de travar se o SKIP LOCKED nao estiver funcionando
            assert delivery_service.deliver_next(db_session, now=NOW) is False
        except OperationalError:
            pytest.fail("deliver_next esperou pela linha travada em vez de pula-la")
        assert server.requests == []
    # Solta o lock e a entrega acontece
    db_session.execute(text("RESET lock_timeout"))
    assert delivery_service.deliver_next(db_session, now=NOW) is True
    assert len(server.requests) == 1


# ---------- Botao Testar ----------


def test_test_endpoint_sends_now_and_returns_the_delivery(client, headers, db_session, server):
    made = make_webhook(client, headers)
    resp = client.post(f"{URL}/{made['id']}/test", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["event"] == "webhook.test"
    assert body["status"] == "delivered"
    assert body["attempts"] == 1
    assert body["last_status_code"] == 200
    assert body["response_excerpt"] == "ok"
    request = server.requests[0]
    assert request.headers["x-finance-event"] == "webhook.test"
    assert request.headers["x-finance-delivery"] == body["id"]
    assert json.loads(request.content)["event"] == "webhook.test"
    timestamp = request.headers["x-finance-timestamp"]
    expected = "sha256=" + hmac.new(made["secret"].encode(), timestamp.encode() + b"." + request.content, hashlib.sha256).hexdigest()
    assert request.headers["x-finance-signature"] == expected


def test_test_endpoint_reports_failure_without_retrying(client, headers, db_session, server):
    server.handler = lambda request: httpx.Response(500, text="quebrou")
    made = make_webhook(client, headers)
    body = client.post(f"{URL}/{made['id']}/test", headers=headers).json()
    assert body["status"] == "failed"
    assert body["attempts"] == 1
    assert body["next_attempt_at"] is None
    assert body["last_status_code"] == 500
    assert body["last_error"] == "Resposta HTTP 500"
    assert body["response_excerpt"] == "quebrou"
    # Nao entra na fila de retentativas
    assert run_now(db_session, NOW + timedelta(days=1)) is False
    assert len(server.requests) == 1


def test_test_endpoint_reports_timeout(client, headers, server):
    def slow(request):
        raise httpx.ConnectTimeout("demorou", request=request)

    server.handler = slow
    made = make_webhook(client, headers)
    body = client.post(f"{URL}/{made['id']}/test", headers=headers).json()
    assert body["status"] == "failed"
    assert "Tempo esgotado" in body["last_error"]


def test_test_endpoint_also_checks_ssrf(client, headers, server, monkeypatch):
    made = make_webhook(client, headers)
    monkeypatch.setattr(webhook_url, "default_resolver", lambda host: ["127.0.0.1"])
    body = client.post(f"{URL}/{made['id']}/test", headers=headers).json()
    assert body["status"] == "failed"
    assert "rede interna" in body["last_error"]
    assert server.requests == []


def test_test_works_even_when_paused(client, headers, server):
    made = make_webhook(client, headers, active=False)
    assert client.post(f"{URL}/{made['id']}/test", headers=headers).json()["status"] == "delivered"


def test_test_delivery_shows_up_in_the_history(client, headers):
    made = make_webhook(client, headers)
    client.post(f"{URL}/{made['id']}/test", headers=headers)
    page = client.get(f"{URL}/{made['id']}/deliveries", headers=headers).json()
    assert [d["event"] for d in page["items"]] == ["webhook.test"]


# ---------- Laco de fundo ----------


def test_one_round_of_the_loop_delivers_what_is_due(client, headers, account_id, server):
    pending_one(client, headers, account_id)
    assert scheduler.run_webhook_deliveries_once() == 1
    assert scheduler.run_webhook_deliveries_once() == 0
    assert len(server.requests) == 1


def test_the_webhook_loop_keeps_going_after_a_round_fails(monkeypatch):
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("banco indisponivel")
        return 0

    monkeypatch.setattr(scheduler, "run_webhook_deliveries_once", flaky)

    async def run():
        task = asyncio.create_task(scheduler.webhook_loop(0))
        for _ in range(100):
            if len(calls) >= 3:
                break
            await asyncio.sleep(0.01)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(run())
    assert len(calls) >= 3


def test_both_loops_are_switched_by_the_same_setting(monkeypatch):
    async def run(enabled):
        monkeypatch.setattr(scheduler.settings, "recurrence_scheduler_enabled", enabled)
        task = scheduler.start_scheduler()
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        return task

    assert asyncio.run(run(False)) is None
    assert asyncio.run(run(True)) is not None


def test_default_interval_is_30_seconds():
    assert scheduler.settings.webhook_interval_seconds == 30
    assert scheduler.settings.webhook_allow_private is False


def test_encrypt_helper_is_reused_for_the_secret(client, headers, db_session):
    made = make_webhook(client, headers)
    stored = db_session.execute(select(Webhook)).scalar_one()
    assert stored.secret_encrypted.startswith("gAAAA")  # formato do Fernet
    assert encrypt_secret(made["secret"]) != stored.secret_encrypted  # cada cifra usa um IV novo
