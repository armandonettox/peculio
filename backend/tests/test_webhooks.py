import logging

import httpx
import uuid

import pytest
from sqlalchemy import event as sa_event
from sqlalchemy import select

from app.core.database import engine
from app.core.two_factor import decrypt_secret
from app.models.webhook import Webhook, WebhookDelivery
from tests.conftest import auth_headers, make_user, register
from tests.webhook_support import no_real_dns, server  # noqa: F401

URL = "/api/v1/webhooks"
EVENTS = ["transaction.created", "transaction.updated", "transaction.deleted"]


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_webhook(client, headers, **overrides):
    body = {
        "name": "Home Assistant",
        "url": "https://hooks.example.com/finance",
        "events": ["transaction.created"],
        **overrides,
    }
    return client.post(URL, json=body, headers=headers)


def other_user_headers(client, db_session, email="outra@example.com"):
    make_user(db_session, email=email)
    return auth_headers(client, email=email)


# ---------- CRUD ----------


def test_requires_login(client):
    assert client.get(URL).status_code == 401
    assert client.post(URL, json={}).status_code == 401
    assert client.post(f"{URL}/{uuid.uuid4()}/test").status_code == 401
    assert client.post(f"{URL}/{uuid.uuid4()}/rotate-secret").status_code == 401
    assert client.get(f"{URL}/{uuid.uuid4()}/deliveries").status_code == 401


def test_create_returns_the_webhook_and_the_secret_once(client, headers):
    resp = make_webhook(client, headers, name="  Home Assistant ", url="  https://hooks.example.com/finance ")
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Home Assistant"
    assert body["url"] == "https://hooks.example.com/finance"
    assert body["events"] == ["transaction.created"]
    assert body["active"] is True
    assert body["last_delivery_status"] is None
    assert body["last_delivery_at"] is None
    assert len(body["secret"]) >= 40


def test_secret_never_appears_after_creation(client, headers):
    created = make_webhook(client, headers).json()
    secret = created["secret"]
    one = client.get(f"{URL}/{created['id']}", headers=headers)
    listing = client.get(URL, headers=headers)
    patched = client.patch(f"{URL}/{created['id']}", json={"name": "Outro"}, headers=headers)
    for resp in (one, listing, patched):
        assert resp.status_code == 200
        assert secret not in resp.text
        assert "secret" not in resp.text


def test_secret_is_stored_encrypted(client, headers, db_session):
    created = make_webhook(client, headers).json()
    stored = db_session.execute(select(Webhook)).scalar_one()
    assert stored.secret_encrypted != created["secret"]
    assert created["secret"] not in stored.secret_encrypted
    assert decrypt_secret(stored.secret_encrypted) == created["secret"]


def test_each_webhook_gets_a_different_secret(client, headers):
    one = make_webhook(client, headers, name="A").json()["secret"]
    two = make_webhook(client, headers, name="B").json()["secret"]
    assert one != two


def test_duplicate_events_are_collapsed(client, headers):
    body = make_webhook(client, headers, events=["transaction.created", "transaction.created", "transaction.deleted"]).json()
    assert body["events"] == ["transaction.created", "transaction.deleted"]


def test_name_is_unique_per_user_ignoring_case(client, headers, db_session):
    assert make_webhook(client, headers, name="Alerta").status_code == 201
    resp = make_webhook(client, headers, name="  ALERTA ")
    assert resp.status_code == 409
    assert resp.json()["code"] == "webhook_name_taken"
    # Outro usuario pode usar o mesmo nome
    other = other_user_headers(client, db_session)
    assert make_webhook(client, other, name="Alerta").status_code == 201


def test_rename_to_an_existing_name_is_refused(client, headers):
    make_webhook(client, headers, name="Um")
    two = make_webhook(client, headers, name="Dois").json()
    resp = client.patch(f"{URL}/{two['id']}", json={"name": "um"}, headers=headers)
    assert resp.status_code == 409
    assert resp.json()["code"] == "webhook_name_taken"


def test_keeping_the_same_name_on_update_is_fine(client, headers):
    created = make_webhook(client, headers, name="Um").json()
    resp = client.patch(f"{URL}/{created['id']}", json={"name": "Um", "active": False}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["active"] is False


def test_update_changes_only_what_was_sent(client, headers):
    created = make_webhook(client, headers, events=EVENTS).json()
    resp = client.patch(f"{URL}/{created['id']}", json={"events": ["transaction.deleted"]}, headers=headers)
    body = resp.json()
    assert body["events"] == ["transaction.deleted"]
    assert body["name"] == created["name"]
    assert body["url"] == created["url"]


def test_null_fields_on_update_are_ignored(client, headers):
    created = make_webhook(client, headers).json()
    resp = client.patch(
        f"{URL}/{created['id']}", json={"name": None, "url": None, "events": None, "active": None}, headers=headers
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == created["name"]
    assert resp.json()["events"] == created["events"]


def test_get_unknown_webhook_is_404(client, headers):
    resp = client.get(f"{URL}/{uuid.uuid4()}", headers=headers)
    assert resp.status_code == 404
    assert resp.json()["code"] == "webhook_not_found"


def test_delete_removes_the_webhook_and_its_deliveries(client, headers, db_session):
    created = make_webhook(client, headers).json()
    client.post(f"{URL}/{created['id']}/test", headers=headers)
    assert db_session.execute(select(WebhookDelivery)).scalars().all()
    assert client.delete(f"{URL}/{created['id']}", headers=headers).status_code == 204
    assert client.get(f"{URL}/{created['id']}", headers=headers).status_code == 404
    db_session.expire_all()
    assert db_session.execute(select(WebhookDelivery)).scalars().all() == []


# ---------- Isolamento entre usuarios ----------


def test_another_users_webhook_is_404_everywhere(client, headers, db_session):
    created = make_webhook(client, headers).json()
    other = other_user_headers(client, db_session)
    wid = created["id"]
    checks = [
        client.get(f"{URL}/{wid}", headers=other),
        client.patch(f"{URL}/{wid}", json={"name": "Invadido"}, headers=other),
        client.delete(f"{URL}/{wid}", headers=other),
        client.post(f"{URL}/{wid}/rotate-secret", headers=other),
        client.post(f"{URL}/{wid}/test", headers=other),
        client.get(f"{URL}/{wid}/deliveries", headers=other),
    ]
    for resp in checks:
        assert resp.status_code == 404
        assert resp.json()["code"] == "webhook_not_found"
    # Nada mudou e o outro usuario nao ve o webhook na lista
    assert client.get(URL, headers=other).json()["total"] == 0
    mine = client.get(f"{URL}/{wid}", headers=headers).json()
    assert mine["name"] == "Home Assistant"
    assert db_session.execute(select(WebhookDelivery)).scalars().all() == []


# ---------- Limite ----------


def test_limit_of_20_webhooks_per_user(client, headers, db_session):
    for index in range(20):
        assert make_webhook(client, headers, name=f"Hook {index}").status_code == 201
    resp = make_webhook(client, headers, name="Hook 20")
    assert resp.status_code == 409
    assert resp.json()["code"] == "webhook_limit_reached"
    # O limite e por usuario
    other = other_user_headers(client, db_session)
    assert make_webhook(client, other, name="Hook 0").status_code == 201


def test_deleting_one_frees_a_slot(client, headers):
    ids = [make_webhook(client, headers, name=f"Hook {i}").json()["id"] for i in range(20)]
    client.delete(f"{URL}/{ids[0]}", headers=headers)
    assert make_webhook(client, headers, name="Novo").status_code == 201


# ---------- Validacao ----------


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 101},
        {"url": ""},
        {"url": "   "},
        {"events": []},
        {"events": ["transaction.exploded"]},
        {"events": ["webhook.test"]},
        {"active": "talvez"},
        {"extra": 1},
    ],
)
def test_invalid_bodies_are_422(client, headers, overrides):
    resp = make_webhook(client, headers, **overrides)
    assert resp.status_code == 422
    assert resp.json()["code"] == "validation_error"


def test_missing_fields_are_422(client, headers):
    assert client.post(URL, json={"name": "So nome"}, headers=headers).status_code == 422


@pytest.mark.parametrize(
    "url",
    [
        "http://hooks.example.com/x",
        "ftp://hooks.example.com/x",
        "https://127.0.0.1/x",
        "https://169.254.169.254/latest/meta-data",
        "https://localhost/x",
        "https://internal.example.com/x",
        "https://user:senha@hooks.example.com/x",
        "not a url",
    ],
)
def test_unsafe_urls_are_refused_on_create(client, headers, url):
    resp = make_webhook(client, headers, url=url)
    assert resp.status_code == 422
    assert resp.json()["code"] == "webhook_url_invalid"
    assert client.get(URL, headers=headers).json()["total"] == 0


def test_unsafe_url_is_refused_on_update(client, headers):
    created = make_webhook(client, headers).json()
    resp = client.patch(f"{URL}/{created['id']}", json={"url": "https://10.0.0.1/x"}, headers=headers)
    assert resp.status_code == 422
    assert resp.json()["code"] == "webhook_url_invalid"
    assert client.get(f"{URL}/{created['id']}", headers=headers).json()["url"] == created["url"]


def test_private_urls_are_accepted_when_allowed(client, headers, monkeypatch):
    from app.core import webhook_url

    monkeypatch.setattr(webhook_url.settings, "webhook_allow_private", True)
    resp = make_webhook(client, headers, url="http://192.168.0.10:8123/api/webhook/abc")
    assert resp.status_code == 201


# ---------- Rotacao do segredo ----------


def test_rotate_secret_returns_a_new_one_and_invalidates_the_old(client, headers, db_session):
    created = make_webhook(client, headers).json()
    resp = client.post(f"{URL}/{created['id']}/rotate-secret", headers=headers)
    assert resp.status_code == 200
    new_secret = resp.json()["secret"]
    assert new_secret != created["secret"]
    stored = db_session.execute(select(Webhook)).scalar_one()
    assert decrypt_secret(stored.secret_encrypted) == new_secret


# ---------- Lista ----------


def test_list_is_paginated_and_ordered_by_name(client, headers):
    for name in ["Charlie", "alfa", "Bravo"]:
        make_webhook(client, headers, name=name)
    body = client.get(URL, params={"limit": 2}, headers=headers).json()
    assert [item["name"] for item in body["items"]] == ["alfa", "Bravo"]
    assert (body["total"], body["limit"], body["offset"]) == (3, 2, 0)
    second = client.get(URL, params={"limit": 2, "offset": 2}, headers=headers).json()
    assert [item["name"] for item in second["items"]] == ["Charlie"]


def test_list_search_ignores_case_and_treats_wildcards_as_text(client, headers):
    make_webhook(client, headers, name="Planilha 100%")
    make_webhook(client, headers, name="Alerta")
    assert [i["name"] for i in client.get(URL, params={"q": "ALER"}, headers=headers).json()["items"]] == ["Alerta"]
    assert [i["name"] for i in client.get(URL, params={"q": "%"}, headers=headers).json()["items"]] == ["Planilha 100%"]
    assert client.get(URL, params={"q": "_"}, headers=headers).json()["total"] == 0


def test_list_rejects_bad_pagination(client, headers):
    assert client.get(URL, params={"limit": 0}, headers=headers).status_code == 422
    assert client.get(URL, params={"limit": 201}, headers=headers).status_code == 422
    assert client.get(URL, params={"offset": -1}, headers=headers).status_code == 422


def test_listing_does_not_run_a_query_per_webhook(client, headers):
    created = [make_webhook(client, headers, name=f"Hook {i}").json()["id"] for i in range(6)]
    for webhook_id in created:
        client.post(f"{URL}/{webhook_id}/test", headers=headers)

    statements = []

    def count(conn, cursor, statement, *args):
        statements.append(statement)

    sa_event.listen(engine, "before_cursor_execute", count)
    try:
        assert len(client.get(URL, headers=headers).json()["items"]) == 6
    finally:
        sa_event.remove(engine, "before_cursor_execute", count)

    # Autenticacao, contagem, pagina e a ultima entrega de todos
    assert len(statements) <= 4, statements


def test_last_delivery_is_the_most_recent_one(client, headers, server):
    created = make_webhook(client, headers).json()
    server.handler = lambda request: httpx.Response(500, text="erro")
    client.post(f"{URL}/{created['id']}/test", headers=headers)
    server.handler = lambda request: httpx.Response(200, text="ok")
    client.post(f"{URL}/{created['id']}/test", headers=headers)
    body = client.get(f"{URL}/{created['id']}", headers=headers).json()
    assert body["last_delivery_status"] == "delivered"
    assert body["last_delivery_at"] is not None


# ---------- Historico de entregas ----------


def test_deliveries_list_newest_first_with_status_filter(client, headers, server):


    created = make_webhook(client, headers).json()
    results = [200, 500, 200]
    for code in results:
        server.handler = lambda request, code=code: httpx.Response(code, text="x")
        client.post(f"{URL}/{created['id']}/test", headers=headers)
    page = client.get(f"{URL}/{created['id']}/deliveries", headers=headers).json()
    assert [d["last_status_code"] for d in page["items"]] == [200, 500, 200]
    assert page["total"] == 3
    only_failed = client.get(f"{URL}/{created['id']}/deliveries", params={"status": "failed"}, headers=headers).json()
    assert [d["last_status_code"] for d in only_failed["items"]] == [500]
    limited = client.get(f"{URL}/{created['id']}/deliveries", params={"limit": 1, "offset": 1}, headers=headers).json()
    assert [d["last_status_code"] for d in limited["items"]] == [500]


def test_deliveries_reject_unknown_status(client, headers):
    created = make_webhook(client, headers).json()
    resp = client.get(f"{URL}/{created['id']}/deliveries", params={"status": "sumido"}, headers=headers)
    assert resp.status_code == 422


def test_secret_never_shows_up_in_logs(client, headers, server, caplog):
    caplog.set_level(logging.DEBUG)
    created = make_webhook(client, headers).json()
    client.post(f"{URL}/{created['id']}/test", headers=headers)
    client.post(f"{URL}/{created['id']}/rotate-secret", headers=headers)
    assert created["secret"] not in caplog.text
