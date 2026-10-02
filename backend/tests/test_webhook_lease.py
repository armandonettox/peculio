"""Entrega com lease: o POST acontece sem transacao aberta e sem lock na linha.

Fluxo: (1) transacao curta reivindica a entrega e empurra next_attempt_at (o lease), (2) commit,
(3) HTTP sem nenhuma transacao, (4) transacao curta registra o resultado."""

import json
import uuid
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError

from app.core.database import SessionLocal
from app.models.webhook import DeliveryStatus, Webhook, WebhookDelivery
from app.services import webhook_delivery as delivery_service
from app.services import webhooks as webhook_service
from tests.test_webhook_delivery import (  # noqa: F401
    NOW,
    account_id,
    create_tx,
    deliveries,
    headers,
    make_webhook,
    only_delivery,
    pending_one,
    run_now,
)
from tests.webhook_support import no_real_dns, server  # noqa: F401

LEASE = delivery_service.LEASE


class SimulatedCrash(BaseException):
    """O processo morreu no meio do POST (BaseException para passar por todos os except Exception)."""


def probe_lock(delivery_id):
    """Numa segunda sessao, tenta travar a linha e devolve (conseguiu, status, next_attempt_at)."""
    with SessionLocal() as other:
        other.execute(text("SET lock_timeout = '500ms'"))
        try:
            row = other.execute(
                select(WebhookDelivery).where(WebhookDelivery.id == delivery_id).with_for_update()
            ).scalar_one()
            result = (True, row.status, row.next_attempt_at)
        except OperationalError:
            result = (False, None, None)
        other.rollback()
    return result


# ---------- O lock nao e mantido durante o HTTP ----------


def test_the_row_is_not_locked_and_no_transaction_is_open_during_the_http_call(
    client, headers, account_id, db_session, server
):
    pending_one(client, headers, account_id)
    delivery_id = only_delivery(db_session).id
    seen = {}

    def handler(request):
        seen["in_transaction"] = db_session.in_transaction()
        seen["probe"] = probe_lock(delivery_id)
        return httpx.Response(200)

    server.handler = handler
    assert run_now(db_session) is True

    assert seen["in_transaction"] is False
    # O corpo enviado e o payload guardado na entrega (copiado para fora da sessao no claim)
    sent = json.loads(server.requests[0].content)
    assert sent == only_delivery(db_session).payload
    assert sent["event"] == "transaction.created"
    locked_ok, status, next_attempt = seen["probe"]
    # Uma segunda sessao conseguiu travar a linha (lock_timeout de 500 ms nao estourou)
    assert locked_ok is True
    # Durante o POST a entrega esta pendente com o lease no lugar da proxima tentativa
    assert status == DeliveryStatus.pending
    assert next_attempt == NOW + LEASE
    delivery = only_delivery(db_session)
    assert delivery.status == DeliveryStatus.delivered
    assert delivery.attempts == 1
    assert delivery.next_attempt_at is None


def test_a_failed_attempt_is_recorded_in_a_new_transaction_with_the_retry_time(
    client, headers, account_id, db_session, server
):
    pending_one(client, headers, account_id)
    server.handler = lambda request: httpx.Response(503)
    run_now(db_session)
    delivery = only_delivery(db_session)
    assert delivery.status == DeliveryStatus.pending
    assert delivery.attempts == 1
    assert delivery.next_attempt_at == NOW + timedelta(minutes=1)
    assert delivery.last_status_code == 503


# ---------- Reivindicar (claim) ----------


def test_claiming_sets_the_lease_commits_and_holds_no_lock(client, headers, account_id, db_session):
    pending_one(client, headers, account_id)
    claim = delivery_service.claim_next(db_session, NOW)
    assert claim is not None and claim.expired is False
    assert claim.lease_until == NOW + LEASE
    assert claim.event == "transaction.created"
    assert claim.url == "https://hooks.example.com/finance"
    assert db_session.in_transaction() is False
    locked_ok, status, next_attempt = probe_lock(claim.delivery_id)
    assert (locked_ok, status, next_attempt) == (True, DeliveryStatus.pending, NOW + LEASE)
    assert only_delivery(db_session).attempts == 0


def test_the_statement_order_is_claim_commit_http_then_a_locked_write(client, headers, account_id, db_session, server):
    """Prova pelo SQL: nada roda entre o commit do claim e o POST, e o resultado vem depois, numa
    transacao nova que trava a linha pelo id."""
    from sqlalchemy import event as sa_event

    from app.core.database import engine

    log = []

    def on_statement(conn, cursor, statement, *args):
        log.append(("sql", " ".join(statement.split())))

    def on_commit(conn):
        log.append(("commit", ""))

    def on_rollback(conn):
        log.append(("rollback", ""))

    def handler(request):
        log.append(("http", ""))
        return httpx.Response(200)

    pending_one(client, headers, account_id)
    server.handler = handler
    sa_event.listen(engine, "before_cursor_execute", on_statement)
    sa_event.listen(engine, "commit", on_commit)
    sa_event.listen(engine, "rollback", on_rollback)
    try:
        run_now(db_session)
    finally:
        sa_event.remove(engine, "before_cursor_execute", on_statement)
        sa_event.remove(engine, "commit", on_commit)
        sa_event.remove(engine, "rollback", on_rollback)

    kinds = [kind for kind, _ in log]
    http_at = kinds.index("http")
    before, after = log[:http_at], log[http_at + 1 :]
    # Antes do POST: o claim (SKIP LOCKED), o lease, e um commit encerrando a transacao
    assert any("SKIP LOCKED" in text_ for kind, text_ in before if kind == "sql")
    assert before[-1][0] == "commit"
    # Depois do POST: o resultado e gravado numa transacao nova, travando a linha pelo id
    selects = [text_ for kind, text_ in after if kind == "sql" and text_.startswith("SELECT")]
    assert selects and "FOR UPDATE" in selects[0] and "SKIP LOCKED" not in selects[0]
    assert "webhook_deliveries.id = " in selects[0]
    assert after[-1][0] == "commit"


def test_claim_returns_none_when_nothing_is_due(client, headers, account_id, db_session):
    assert delivery_service.claim_next(db_session, NOW) is None
    assert db_session.in_transaction() is False
    pending_one(client, headers, account_id)
    # Antes do vencimento (a entrega nasceu com a data de hoje, bem antes de NOW)
    assert delivery_service.claim_next(db_session, NOW.replace(year=2000)) is None


def test_a_claimed_delivery_is_invisible_to_other_workers_until_the_lease_ends(
    client, headers, account_id, db_session, server
):
    pending_one(client, headers, account_id)
    assert delivery_service.claim_next(db_session, NOW) is not None
    with SessionLocal() as other:
        assert delivery_service.claim_next(other, NOW) is None
        assert delivery_service.claim_next(other, NOW + LEASE - timedelta(seconds=1)) is None
        again = delivery_service.claim_next(other, NOW + LEASE)
        assert again is not None


def test_the_lease_is_comfortably_longer_than_the_http_timeout():
    assert LEASE >= timedelta(seconds=delivery_service.TIMEOUT_SECONDS * 12)


# ---------- Sem entrega duplicada com dois workers ----------


def test_a_second_worker_cannot_take_a_delivery_that_is_being_sent(client, headers, account_id, db_session, server):
    pending_one(client, headers, account_id)
    inner = {}

    def handler(request):
        with SessionLocal() as other:
            inner["took"] = delivery_service.deliver_next(other, now=NOW + timedelta(seconds=30))
        return httpx.Response(200)

    server.handler = handler
    assert run_now(db_session) is True
    assert inner["took"] is False
    assert len(server.requests) == 1
    assert only_delivery(db_session).status == DeliveryStatus.delivered


def test_two_workers_send_different_deliveries_at_the_same_time_each_exactly_once(
    client, headers, account_id, db_session, server
):
    make_webhook(client, headers, events=["transaction.created"])
    create_tx(client, headers, account_id, description="Primeira")
    create_tx(client, headers, account_id, description="Segunda")
    state = {"nested": False}

    def handler(request):
        if not state["nested"]:
            state["nested"] = True
            with SessionLocal() as other:
                # Enquanto a primeira esta em voo, o outro worker pega a segunda, nao a mesma
                assert delivery_service.deliver_next(other, now=NOW) is True
        return httpx.Response(200)

    server.handler = handler
    assert run_now(db_session) is True
    assert len(server.requests) == 2
    sent = {request.headers["x-finance-delivery"] for request in server.requests}
    assert len(sent) == 2
    assert {row.status for row in deliveries(db_session)} == {DeliveryStatus.delivered}
    assert {row.attempts for row in deliveries(db_session)} == {1}


# ---------- Processo que morre no meio ----------


def test_a_process_that_dies_mid_post_loses_nothing_and_the_lease_expiry_brings_it_back(
    client, headers, account_id, db_session, server
):
    pending_one(client, headers, account_id)

    def dies(request):
        raise SimulatedCrash()

    server.handler = dies
    with pytest.raises(SimulatedCrash):
        run_now(db_session)
    db_session.rollback()

    # A entrega continua la, pendente, com o lease como proxima tentativa e sem tentativa contada
    delivery = only_delivery(db_session)
    assert delivery.status == DeliveryStatus.pending
    assert delivery.attempts == 0
    assert delivery.next_attempt_at == NOW + LEASE

    # Antes do lease vencer ninguem pega; depois, outra rodada entrega
    server.handler = lambda request: httpx.Response(200)
    assert run_now(db_session, NOW + LEASE - timedelta(seconds=1)) is False
    assert run_now(db_session, NOW + LEASE + timedelta(seconds=1)) is True
    delivery = only_delivery(db_session)
    assert delivery.status == DeliveryStatus.delivered
    assert delivery.attempts == 1
    assert len(server.requests) == 2


def test_a_slow_worker_whose_lease_was_taken_over_does_not_overwrite_the_newer_result(
    client, headers, account_id, db_session, server
):
    pending_one(client, headers, account_id)
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            # O lease do primeiro venceu; outro worker pega a mesma entrega e entrega com sucesso
            with SessionLocal() as other:
                assert delivery_service.deliver_next(other, now=NOW + LEASE + timedelta(seconds=1)) is True
            return httpx.Response(500)
        return httpx.Response(200)

    server.handler = handler
    run_now(db_session)
    # O resultado descartado nao deixa transacao nem lock para tras
    assert db_session.in_transaction() is False
    delivery = only_delivery(db_session)
    assert len(calls) == 2
    # Vale o resultado de quem estava com o lease atual; a falha atrasada do primeiro foi descartada
    assert delivery.status == DeliveryStatus.delivered
    assert delivery.attempts == 1
    assert delivery.last_status_code == 200


def test_a_slow_worker_whose_lease_was_taken_over_and_is_still_in_flight_is_also_discarded(
    client, headers, account_id, db_session, server
):
    pending_one(client, headers, account_id)
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            # O segundo worker reivindica (novo lease) mas ainda nao terminou quando o primeiro volta
            with SessionLocal() as other:
                assert delivery_service.claim_next(other, NOW + LEASE + timedelta(seconds=1)) is not None
        return httpx.Response(200)

    server.handler = handler
    run_now(db_session)
    delivery = only_delivery(db_session)
    # O primeiro nao pode gravar por cima: segue pendente com o lease do segundo worker
    assert delivery.status == DeliveryStatus.pending
    assert delivery.attempts == 0
    assert delivery.next_attempt_at == NOW + LEASE + timedelta(seconds=1) + LEASE


# ---------- Mudancas durante o POST ----------


def test_the_webhook_deleted_during_the_post_does_not_break_recording(client, headers, account_id, db_session, server):
    made = pending_one(client, headers, account_id)

    def handler(request):
        with SessionLocal() as other:
            webhook = other.get(Webhook, uuid.UUID(made["id"]))
            other.delete(webhook)
            other.commit()
        return httpx.Response(200)

    server.handler = handler
    assert run_now(db_session) is True
    assert deliveries(db_session) == []


def test_pausing_during_the_post_keeps_the_expired_status(client, headers, account_id, db_session, server):
    made = pending_one(client, headers, account_id)

    def handler(request):
        with SessionLocal() as other:
            webhook = other.get(Webhook, uuid.UUID(made["id"]))
            webhook.active = False
            webhook_service.expire_pending(other, webhook.id)
            other.commit()
        return httpx.Response(200)

    server.handler = handler
    assert run_now(db_session) is True
    delivery = only_delivery(db_session)
    # O POST ja tinha saido, mas o estado final da pausa nao e sobrescrito
    assert delivery.status == DeliveryStatus.expired
    assert delivery.last_error == delivery_service.PAUSED_REASON


def test_the_http_error_path_also_runs_without_a_transaction(client, headers, account_id, db_session, server):
    pending_one(client, headers, account_id)
    seen = {}

    def handler(request):
        seen["in_transaction"] = db_session.in_transaction()
        raise httpx.ConnectError("recusado", request=request)

    server.handler = handler
    run_now(db_session)
    assert seen["in_transaction"] is False
    assert only_delivery(db_session).attempts == 1


def test_deliver_next_does_not_post_for_a_paused_webhook(client, headers, account_id, db_session, server):
    made = pending_one(client, headers, account_id)
    webhook = db_session.get(Webhook, uuid.UUID(made["id"]))
    webhook.active = False
    db_session.commit()
    assert run_now(db_session) is True
    assert server.requests == []
    assert only_delivery(db_session).status == DeliveryStatus.expired


def test_the_oldest_due_delivery_is_claimed_first(client, headers, account_id, db_session):
    make_webhook(client, headers, events=["transaction.created"])
    create_tx(client, headers, account_id, description="Primeira")
    create_tx(client, headers, account_id, description="Segunda")
    first, second = deliveries(db_session)
    second.next_attempt_at = first.next_attempt_at - timedelta(days=1)
    db_session.commit()
    claim = delivery_service.claim_next(db_session, NOW)
    assert claim.delivery_id == second.id


def test_a_paused_webhook_expires_without_any_http_and_without_a_lease(
    client, headers, account_id, db_session, server
):
    made = pending_one(client, headers, account_id)
    webhook = db_session.get(Webhook, uuid.UUID(made["id"]))
    webhook.active = False
    db_session.commit()
    claim = delivery_service.claim_next(db_session, NOW)
    assert claim is not None and claim.expired is True
    assert server.requests == []
    assert only_delivery(db_session).status == DeliveryStatus.expired
