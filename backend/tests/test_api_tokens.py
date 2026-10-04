import hashlib
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from app.core import clock
from app.core.config import settings
from app.main import app
from app.models.api_token import ApiToken
from app.models.user import User
from app.services import api_tokens as service
from tests.conftest import auth_headers, bearer, make_user, register

API = "/api/v1"
TOKENS = f"{API}/api-tokens"
ACCOUNTS = f"{API}/accounts"
TX = f"{API}/transactions"


@pytest.fixture(autouse=True)
def fresh_rate_window():
    service.rate_limiter.reset()
    yield
    service.rate_limiter.reset()


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_token(client, headers, name="Script", scope="write", **extra):
    response = client.post(TOKENS, json={"name": name, "scope": scope, **extra}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def use(value):
    return bearer(value)


def make_account(client, headers, **overrides):
    body = {"name": "Nubank", "type": "asset", "currency_code": "BRL", "opening_balance": "1000.00", **overrides}
    return client.post(ACCOUNTS, json=body, headers=headers).json()["id"]


def spend(client, headers, account_id):
    split = {
        "type": "withdrawal", "date": "2026-03-05", "description": "Cafe", "amount": "8.00",
        "currency_code": "BRL", "account_id": account_id, "counterparty_name": "Padaria",
    }
    return client.post(TX, json={"splits": [split]}, headers=headers)


# ---------- Criar ----------


def test_requires_login(client):
    assert client.get(TOKENS).status_code == 401
    assert client.post(TOKENS, json={"name": "x", "scope": "read"}).status_code == 401
    assert client.delete(f"{TOKENS}/{uuid.uuid4()}").status_code == 401


def test_create_returns_the_value_once_with_a_recognizable_prefix(client, headers):
    created = make_token(client, headers, name="Planilha", scope="read")
    value = created["token"]
    assert value.startswith("fin_") and len(value) == 4 + 43
    assert created["prefix"] == value[:12]
    assert created["scope"] == "read" and created["name"] == "Planilha"
    assert created["expires_at"] is None and created["last_used_at"] is None and created["expired"] is False
    assert uuid.UUID(created["id"])


def test_two_tokens_never_share_a_value(client, headers):
    values = {make_token(client, headers, name=f"T{n}")["token"] for n in range(3)}
    assert len(values) == 3


def test_only_the_hash_is_stored_never_the_value(client, headers, db_session):
    value = make_token(client, headers)["token"]
    row = db_session.execute(select(ApiToken)).scalar_one()
    assert row.token_hash == hashlib.sha256(value.encode()).hexdigest()
    assert row.prefix == value[:12]
    dump = " ".join(
        str(item)
        for item in db_session.execute(text("SELECT id::text, name, token_hash, prefix, scope FROM api_tokens")).one()
    )
    assert value not in dump


def test_expiry_is_counted_in_days_from_now_and_empty_means_never(client, headers):
    before = clock.utc_now()
    created = make_token(client, headers, name="Noventa", expires_in_days=90)
    expires = datetime.fromisoformat(created["expires_at"])
    assert before + timedelta(days=90) <= expires <= clock.utc_now() + timedelta(days=90)
    assert make_token(client, headers, name="Nunca", expires_in_days=None)["expires_at"] is None
    assert make_token(client, headers, name="Um", expires_in_days=1)["expires_at"] is not None
    assert make_token(client, headers, name="Dez anos", expires_in_days=3650)["expires_at"] is not None


@pytest.mark.parametrize(
    "body",
    [
        {"name": "", "scope": "read"},
        {"name": "   ", "scope": "read"},
        {"name": "x" * 101, "scope": "read"},
        {"name": "x"},
        {"scope": "read"},
        {"name": "x", "scope": "admin"},
        {"name": "x", "scope": "read", "expires_in_days": 0},
        {"name": "x", "scope": "read", "expires_in_days": -5},
        {"name": "x", "scope": "read", "expires_in_days": 3651},
        {"name": "x", "scope": "read", "expires_in_days": "noventa"},
        {"name": "x", "scope": "read", "extra": 1},
    ],
)
def test_create_validation_returns_422(client, headers, body):
    response = client.post(TOKENS, json=body, headers=headers)
    assert response.status_code == 422 and response.json()["code"] == "validation_error"


def test_name_is_cleaned_and_unique_ignoring_case(client, headers):
    assert make_token(client, headers, name="  Meu   script ")["name"] == "Meu script"
    clash = client.post(TOKENS, json={"name": "MEU SCRIPT", "scope": "read"}, headers=headers)
    assert clash.status_code == 409 and clash.json()["code"] == "api_token_name_taken"


def test_the_same_name_is_fine_for_another_user(client, headers, db_session):
    make_token(client, headers, name="Script")
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    assert client.post(TOKENS, json={"name": "Script", "scope": "read"}, headers=other).status_code == 201


def test_limit_of_ten_tokens_per_user(client, headers, db_session):
    for n in range(10):
        make_token(client, headers, name=f"T{n}")
    refused = client.post(TOKENS, json={"name": "Onze", "scope": "read"}, headers=headers)
    assert refused.status_code == 409 and refused.json()["code"] == "api_token_limit_reached"
    # Revogar um abre vaga; outro usuario tem o proprio limite
    first = client.get(TOKENS, headers=headers).json()["items"][0]["id"]
    assert client.delete(f"{TOKENS}/{first}", headers=headers).status_code == 204
    assert client.post(TOKENS, json={"name": "Onze", "scope": "read"}, headers=headers).status_code == 201
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    assert client.post(TOKENS, json={"name": "Primeiro", "scope": "read"}, headers=other).status_code == 201


# ---------- Listar e revogar ----------


def test_list_never_shows_the_value_and_puts_the_newest_first(client, headers):
    first = make_token(client, headers, name="Velho")
    second = make_token(client, headers, name="Novo", scope="read", expires_in_days=30)
    body = client.get(TOKENS, headers=headers).json()
    assert body["total"] == 2 and [i["name"] for i in body["items"]] == ["Novo", "Velho"]
    assert all("token" not in item for item in body["items"])
    assert body["items"][0]["prefix"] == second["prefix"] and body["items"][1]["prefix"] == first["prefix"]
    assert set(body["items"][0]) == {"id", "name", "prefix", "scope", "expires_at", "last_used_at", "created_at", "expired"}


def test_list_shows_only_my_tokens(client, headers, db_session):
    make_token(client, headers, name="Meu")
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    make_token(client, other, name="Dela")
    assert [i["name"] for i in client.get(TOKENS, headers=headers).json()["items"]] == ["Meu"]
    assert [i["name"] for i in client.get(TOKENS, headers=other).json()["items"]] == ["Dela"]


def test_an_expired_token_stays_in_the_list_marked_as_expired(client, headers, db_session):
    created = make_token(client, headers, expires_in_days=30)
    db_session.execute(
        text("UPDATE api_tokens SET expires_at = :moment WHERE id = :id"),
        {"moment": clock.utc_now() - timedelta(days=1), "id": created["id"]},
    )
    db_session.commit()
    item = client.get(TOKENS, headers=headers).json()["items"][0]
    assert item["expired"] is True


def test_revoking_stops_the_token_at_once(client, headers):
    created = make_token(client, headers)
    assert client.get(ACCOUNTS, headers=use(created["token"])).status_code == 200
    assert client.delete(f"{TOKENS}/{created['id']}", headers=headers).status_code == 204
    response = client.get(ACCOUNTS, headers=use(created["token"]))
    assert response.status_code == 401 and response.json()["code"] == "token_invalid"
    assert client.get(TOKENS, headers=headers).json()["total"] == 0


def test_other_users_token_is_404_and_stays_alive(client, headers, db_session):
    created = make_token(client, headers)
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    response = client.delete(f"{TOKENS}/{created['id']}", headers=other)
    assert response.status_code == 404 and response.json()["code"] == "api_token_not_found"
    assert client.delete(f"{TOKENS}/{uuid.uuid4()}", headers=headers).status_code == 404
    assert client.get(ACCOUNTS, headers=use(created["token"])).status_code == 200


def test_deleting_the_user_removes_the_tokens(client, headers, db_session):
    make_token(client, headers)
    user = db_session.execute(select(User)).scalar_one()
    db_session.delete(user)
    db_session.commit()
    assert db_session.execute(select(ApiToken)).first() is None


# ---------- Usar: leitura e escrita ----------


def test_a_read_token_reads_the_same_routes_the_screen_does(client, headers):
    account_id = make_account(client, headers)
    value = make_token(client, headers, scope="read")["token"]
    for path in (ACCOUNTS, f"{ACCOUNTS}/{account_id}", TX, f"{API}/auth/me", f"{API}/dashboard/net-worth"):
        assert client.get(path, headers=use(value)).status_code == 200, path
    assert client.head(ACCOUNTS, headers=use(value)).status_code in (200, 405)
    assert client.get(ACCOUNTS, headers=use(value)).json()["items"][0]["id"] == account_id


def test_a_read_token_cannot_write_and_nothing_changes(client, headers):
    account_id = make_account(client, headers)
    value = make_token(client, headers, scope="read")["token"]
    before = client.get(TX, headers=headers).json()["total"]
    refused = spend(client, use(value), account_id)
    assert refused.status_code == 403 and refused.json()["code"] == "api_token_read_only"
    assert client.get(TX, headers=headers).json()["total"] == before
    renamed = client.patch(f"{ACCOUNTS}/{account_id}", json={"name": "Outro"}, headers=use(value))
    assert renamed.status_code == 403 and renamed.json()["code"] == "api_token_read_only"
    assert client.get(f"{ACCOUNTS}/{account_id}", headers=headers).json()["name"] == "Nubank"
    assert client.delete(f"{ACCOUNTS}/{account_id}", headers=use(value)).status_code == 403


def test_a_write_token_reads_and_writes(client, headers):
    account_id = make_account(client, headers)
    value = make_token(client, headers, scope="write")["token"]
    created = spend(client, use(value), account_id)
    assert created.status_code == 201
    assert client.patch(f"{ACCOUNTS}/{account_id}", json={"name": "Renomeada"}, headers=use(value)).status_code == 200
    transaction_id = created.json()["id"]
    assert client.delete(f"{TX}/{transaction_id}", headers=use(value)).status_code == 204
    assert client.get(ACCOUNTS, headers=use(value)).status_code == 200


def test_the_token_acts_as_its_owner_and_never_sees_other_users_data(client, headers, db_session):
    make_account(client, headers, name="Minha")
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    make_account(client, other, name="Dela")
    value = make_token(client, headers, scope="read")["token"]
    names = [item["name"] for item in client.get(ACCOUNTS, headers=use(value)).json()["items"]]
    assert names == ["Minha"]


def test_every_write_route_refuses_a_read_token(client, headers):
    """Varre o OpenAPI: toda rota que nao e consulta recusa o token de leitura. Uma rota nova entra sozinha;
    uma rota publica nova de escrita falha aqui e obriga a decidir."""
    value = make_token(client, headers, scope="read")["token"]
    public = {"/api/v1/auth/register", "/api/v1/auth/login", "/api/v1/auth/2fa/verify"}
    checked, wrong = 0, []
    for path, methods in app.openapi()["paths"].items():
        if path in public:
            continue
        for method in methods:
            if method.upper() in ("GET", "HEAD", "OPTIONS"):
                continue
            url = re.sub(r"\{[^}]+\}", lambda _: str(uuid.uuid4()), path)
            response = client.request(method.upper(), url, headers=use(value))
            checked += 1
            code = response.json().get("code") if response.headers.get("content-type", "").startswith("application/json") else None
            if response.status_code != 403 or code not in ("api_token_read_only", "session_required"):
                wrong.append(f"{method.upper()} {path} -> {response.status_code} {code}")
    assert checked >= 40
    assert wrong == []


# ---------- Usar: o que token nunca faz ----------


def test_a_token_never_manages_tokens_or_the_session(client, headers):
    value = make_token(client, headers, scope="write")["token"]
    attempts = [
        client.post(TOKENS, json={"name": "Filho", "scope": "write"}, headers=use(value)),
        client.get(TOKENS, headers=use(value)),
        client.delete(f"{TOKENS}/{uuid.uuid4()}", headers=use(value)),
        client.post(f"{API}/auth/refresh", headers=use(value)),
    ]
    for response in attempts:
        assert response.status_code == 403 and response.json()["code"] == "session_required"
    assert client.get(TOKENS, headers=headers).json()["total"] == 1


@pytest.mark.parametrize("path", ["status", "setup", "enable", "disable", "recovery-codes"])
def test_a_token_never_touches_two_factor(client, headers, path):
    value = make_token(client, headers, scope="write")["token"]
    response = client.request("GET" if path == "status" else "POST", f"{API}/auth/2fa/{path}", headers=use(value), json={} if path != "status" else None)
    assert response.status_code == 403 and response.json()["code"] == "session_required"


def test_a_token_of_an_admin_never_creates_invites(client, headers):
    value = make_token(client, headers, scope="write")["token"]
    assert client.post(f"{API}/invites", json={}, headers=use(value)).status_code == 403
    assert client.get(f"{API}/invites", headers=use(value)).json()["code"] == "session_required"
    assert client.get(f"{API}/invites", headers=headers).status_code == 200


def test_a_token_cannot_trade_itself_for_a_session(client, headers):
    value = make_token(client, headers, scope="read")["token"]
    refreshed = client.post(f"{API}/auth/refresh", headers=use(value))
    assert refreshed.status_code == 403 and "access_token" not in refreshed.text


# ---------- Usar: erros ----------


@pytest.mark.parametrize("value", ["fin_", "fin_naoexiste", "fin_" + "a" * 43, "fin_ com espaco", "FIN_" + "a" * 43])
def test_an_unknown_token_is_invalid(client, headers, value):
    response = client.get(ACCOUNTS, headers={"Authorization": f"Bearer {value}"})
    assert response.status_code == 401
    assert response.json()["code"] in ("token_invalid",)
    assert response.headers["www-authenticate"] == "Bearer"


def test_missing_header_is_still_token_missing(client):
    response = client.get(ACCOUNTS)
    assert response.status_code == 401 and response.json()["code"] == "token_missing"


def test_an_expired_token_has_its_own_error(client, headers, db_session):
    created = make_token(client, headers, expires_in_days=30)
    assert client.get(ACCOUNTS, headers=use(created["token"])).status_code == 200
    db_session.execute(
        text("UPDATE api_tokens SET expires_at = :moment WHERE id = :id"),
        {"moment": clock.utc_now() - timedelta(seconds=1), "id": created["id"]},
    )
    db_session.commit()
    response = client.get(ACCOUNTS, headers=use(created["token"]))
    assert response.status_code == 401 and response.json()["code"] == "api_token_expired"
    assert "criar" in response.json()["detail"] or "crie" in response.json()["detail"]


def test_a_token_that_expires_in_the_future_still_works(client, headers, db_session):
    created = make_token(client, headers, expires_in_days=1)
    assert client.get(ACCOUNTS, headers=use(created["token"])).status_code == 200


def test_a_locked_account_stops_its_tokens(client, headers, db_session):
    value = make_token(client, headers)["token"]
    user = db_session.execute(select(User)).scalar_one()
    user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=10)
    db_session.commit()
    response = client.get(ACCOUNTS, headers=use(value))
    assert response.status_code == 401 and response.json()["code"] == "account_locked"


def test_the_screen_login_still_works_next_to_tokens(client, headers):
    make_token(client, headers)
    assert client.get(ACCOUNTS, headers=headers).status_code == 200
    assert client.get(ACCOUNTS, headers={"Authorization": "Bearer lixo"}).json()["code"] == "token_invalid"


# ---------- Ultimo uso ----------


def stored(db_session, token_id):
    db_session.expire_all()
    return db_session.get(ApiToken, uuid.UUID(token_id)).last_used_at


def test_last_used_is_recorded_on_the_first_use(client, headers, db_session):
    created = make_token(client, headers)
    assert stored(db_session, created["id"]) is None
    client.get(ACCOUNTS, headers=use(created["token"]))
    used = stored(db_session, created["id"])
    assert used is not None and abs((clock.utc_now() - used).total_seconds()) < 30
    assert client.get(TOKENS, headers=headers).json()["items"][0]["last_used_at"] is not None


def test_last_used_is_not_rewritten_within_a_minute_but_is_after(client, headers, db_session):
    created = make_token(client, headers)
    client.get(ACCOUNTS, headers=use(created["token"]))
    first = stored(db_session, created["id"])
    client.get(ACCOUNTS, headers=use(created["token"]))
    assert stored(db_session, created["id"]) == first

    older = clock.utc_now() - timedelta(minutes=2)
    db_session.execute(text("UPDATE api_tokens SET last_used_at = :moment"), {"moment": older})
    db_session.commit()
    client.get(ACCOUNTS, headers=use(created["token"]))
    assert stored(db_session, created["id"]) > older + timedelta(minutes=1)


def test_a_refused_call_does_not_count_as_use(client, headers, db_session):
    created = make_token(client, headers, scope="read")
    client.post(TOKENS, json={"name": "x", "scope": "read"}, headers=use(created["token"]))
    assert stored(db_session, created["id"]) is None
    client.delete(f"{ACCOUNTS}/{uuid.uuid4()}", headers=use(created["token"]))
    assert stored(db_session, created["id"]) is None


def test_the_screen_login_does_not_touch_any_token(client, headers, db_session):
    created = make_token(client, headers)
    client.get(ACCOUNTS, headers=headers)
    assert stored(db_session, created["id"]) is None


# ---------- Limite de uso ----------


@pytest.fixture
def tight_limit(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(settings, "api_token_rate_per_minute", 3)


def test_a_token_over_the_limit_gets_429_with_retry_after(client, headers, tight_limit):
    value = make_token(client, headers)["token"]
    for _ in range(3):
        assert client.get(ACCOUNTS, headers=use(value)).status_code == 200
    blocked = client.get(ACCOUNTS, headers=use(value))
    assert blocked.status_code == 429 and blocked.json()["code"] == "rate_limited"
    assert blocked.headers["retry-after"] == "60"


def test_the_limit_is_per_token_and_does_not_touch_the_screen_login(client, headers, tight_limit):
    first = make_token(client, headers, name="Um")["token"]
    second = make_token(client, headers, name="Dois")["token"]
    for _ in range(3):
        client.get(ACCOUNTS, headers=use(first))
    assert client.get(ACCOUNTS, headers=use(first)).status_code == 429
    assert client.get(ACCOUNTS, headers=use(second)).status_code == 200
    for _ in range(6):
        assert client.get(ACCOUNTS, headers=headers).status_code == 200


def test_a_refused_unknown_token_does_not_eat_a_real_ones_budget(client, headers, tight_limit):
    value = make_token(client, headers)["token"]
    for _ in range(10):
        client.get(ACCOUNTS, headers={"Authorization": "Bearer fin_" + "x" * 43})
    assert client.get(ACCOUNTS, headers=use(value)).status_code == 200


def test_the_limit_can_be_turned_off(client, headers, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    monkeypatch.setattr(settings, "api_token_rate_per_minute", 1)
    value = make_token(client, headers)["token"]
    for _ in range(5):
        assert client.get(ACCOUNTS, headers=use(value)).status_code == 200


def test_revoking_clears_the_window(client, headers, tight_limit):
    created = make_token(client, headers)
    for _ in range(3):
        client.get(ACCOUNTS, headers=use(created["token"]))
    client.delete(f"{TOKENS}/{created['id']}", headers=headers)
    assert created["id"] not in {str(key) for key in service.rate_limiter._hits}


def test_the_default_limit_is_120_a_minute():
    assert settings.api_token_rate_per_minute == 120


# ---------- Janela do limite (unidade) ----------


def test_window_allows_up_to_the_limit_then_blocks_until_it_slides():
    limiter = service.TokenRateLimiter()
    token = uuid.uuid4()
    assert [limiter.allow(token, 3, now=moment) for moment in (0.0, 10.0, 20.0)] == [True, True, True]
    assert limiter.allow(token, 3, now=30.0) is False
    assert limiter.allow(token, 3, now=59.9) is False
    # A primeira chamada (em 0) sai da janela de 60 s exatamente em 60
    assert limiter.allow(token, 3, now=60.0) is True
    assert limiter.allow(token, 3, now=60.5) is False
    assert limiter.allow(token, 3, now=70.0) is True


def test_blocked_calls_do_not_extend_the_wait():
    limiter = service.TokenRateLimiter()
    token = uuid.uuid4()
    limiter.allow(token, 1, now=0.0)
    for moment in (10.0, 20.0, 30.0):
        assert limiter.allow(token, 1, now=moment) is False
    assert limiter.allow(token, 1, now=60.0) is True


def test_window_is_per_token_and_forget_and_reset_clear_it():
    limiter = service.TokenRateLimiter()
    first, second = uuid.uuid4(), uuid.uuid4()
    limiter.allow(first, 1, now=0.0)
    assert limiter.allow(first, 1, now=1.0) is False
    assert limiter.allow(second, 1, now=1.0) is True
    limiter.forget(first)
    assert limiter.allow(first, 1, now=2.0) is True
    limiter.reset()
    assert limiter.allow(second, 1, now=3.0) is True
    limiter.forget(uuid.uuid4())


def test_window_uses_the_real_clock_by_default():
    limiter = service.TokenRateLimiter()
    token = uuid.uuid4()
    assert limiter.allow(token, 1) is True and limiter.allow(token, 1) is False


# ---------- Funcoes puras ----------


def test_hash_is_sha256_hex_and_the_value_format_is_stable():
    assert service.hash_token("fin_abc") == hashlib.sha256(b"fin_abc").hexdigest()
    value = service.new_token_value()
    assert value.startswith(service.TOKEN_PREFIX) and len(value) == 47
    assert service.new_token_value() != value


@pytest.mark.parametrize(
    "scope, method, allowed",
    [
        ("read", "GET", True), ("read", "get", True), ("read", "HEAD", True), ("read", "OPTIONS", True),
        ("read", "POST", False), ("read", "PUT", False), ("read", "PATCH", False), ("read", "DELETE", False),
        ("write", "GET", True), ("write", "POST", True), ("write", "PUT", True), ("write", "PATCH", True), ("write", "DELETE", True),
    ],
)
def test_scope_by_method(scope, method, allowed):
    assert service.allows_method(ApiToken(scope=scope), method) is allowed


def test_expiry_check_and_last_used_granularity():
    now = clock.utc_now()
    assert service.is_expired(ApiToken(expires_at=None)) is False
    assert service.is_expired(ApiToken(expires_at=now + timedelta(seconds=5))) is False
    assert service.is_expired(ApiToken(expires_at=now - timedelta(seconds=5))) is True
    assert service.needs_last_used_update(ApiToken(last_used_at=None)) is True
    assert service.needs_last_used_update(ApiToken(last_used_at=now - timedelta(seconds=30))) is False
    assert service.needs_last_used_update(ApiToken(last_used_at=now - timedelta(minutes=1, seconds=1))) is True
