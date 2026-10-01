import re

import pytest
from fastapi.testclient import TestClient

from app.core.errors import ErrorCode
from app.core.rate_limit import limiter
from app.main import app
from tests.conftest import DEFAULT_PASSWORD, bearer, login_token, make_user, register


def assert_error(resp, status: int, code: str):
    assert resp.status_code == status
    body = resp.json()
    assert body["code"] == code
    assert isinstance(body["detail"], str) and body["detail"]
    return body


def test_error_codes_are_unique_snake_case():
    values = [c.value for c in ErrorCode]
    assert len(values) == len(set(values))
    assert all(re.fullmatch(r"[a-z]+(_[a-z]+)*", v) for v in values)


def test_missing_token_returns_401_with_code_and_bearer_header(client):
    resp = client.get("/api/v1/auth/me")
    assert_error(resp, 401, "token_missing")
    assert resp.headers["www-authenticate"] == "Bearer"


def test_invalid_token_returns_401(client):
    resp = client.get("/api/v1/auth/me", headers=bearer("lixo"))
    assert_error(resp, 401, "token_invalid")


def test_invalid_credentials_returns_401(client):
    register(client)
    resp = client.post(
        "/api/v1/auth/login", json={"email": "admin@example.com", "password": "SenhaErrada1"}
    )
    body = assert_error(resp, 401, "invalid_credentials")
    assert set(body) == {"detail", "code"}


def test_locked_account_returns_423(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.max_failed_login_attempts", 1)
    register(client)
    client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "SenhaErrada1"})
    resp = client.post(
        "/api/v1/auth/login", json={"email": "admin@example.com", "password": DEFAULT_PASSWORD}
    )
    assert_error(resp, 423, "account_locked")


def test_non_admin_gets_403(client, db_session):
    register(client)
    make_user(db_session, email="comum@example.com")
    headers = bearer(login_token(client, email="comum@example.com"))
    resp = client.get("/api/v1/invites", headers=headers)
    assert_error(resp, 403, "admin_required")


def test_register_without_invite_code(client):
    register(client)
    resp = register(client, email="outro@example.com")
    assert_error(resp, 403, "invite_required")


def test_register_with_bad_invite_code(client):
    register(client)
    resp = register(client, email="outro@example.com", invite_token="lixo")
    assert_error(resp, 403, "invite_invalid")


def test_unknown_route_returns_404_in_our_format(client):
    resp = client.get("/api/v1/nao-existe")
    assert_error(resp, 404, "not_found")


def test_wrong_method_returns_405_in_our_format(client):
    resp = client.delete("/api/health")
    assert_error(resp, 405, "method_not_allowed")


def test_unknown_invite_returns_404(client):
    import uuid

    register(client)
    headers = bearer(login_token(client))
    resp = client.delete(f"/api/v1/invites/{uuid.uuid4()}", headers=headers)
    assert_error(resp, 404, "invite_not_found")


def test_validation_error_lists_fields_without_echoing_input(client):
    resp = client.post(
        "/api/v1/auth/register",
        json={"name": "Admin", "email": "nao-e-email", "password": "curta"},
    )
    body = assert_error(resp, 422, "validation_error")
    fields = {e["field"] for e in body["errors"]}
    assert {"email", "password"} <= fields
    assert all(set(e) == {"field", "message"} for e in body["errors"])
    # A senha digitada nao pode voltar na resposta
    assert "curta" not in resp.text
    assert "nao-e-email" not in resp.text


def test_validation_message_has_no_pydantic_prefix(client):
    resp = client.post(
        "/api/v1/auth/register",
        json={"name": "Admin", "email": "admin@example.com", "password": "curta"},
    )
    messages = [e["message"] for e in resp.json()["errors"]]
    assert "Senha deve ter pelo menos 8 caracteres" in messages


def test_query_validation_error_uses_same_format(client):
    register(client)
    headers = bearer(login_token(client))
    resp = client.get("/api/v1/invites?limit=0", headers=headers)
    body = assert_error(resp, 422, "validation_error")
    assert body["errors"][0]["field"] == "limit"


def test_rate_limit_returns_429_with_retry_after(client):
    register(client)
    limiter.enabled = True
    limiter.reset()
    try:
        body = {"email": "admin@example.com", "password": "SenhaErrada1"}
        responses = [client.post("/api/v1/auth/login", json=body) for _ in range(12)]
    finally:
        limiter.reset()
        limiter.enabled = False
    limited = [r for r in responses if r.status_code == 429]
    assert limited
    assert_error(limited[0], 429, "rate_limited")
    assert limited[0].headers["retry-after"] == "60"


@pytest.fixture
def boom_route():
    async def boom():
        raise RuntimeError("segredo-interno-do-servidor")

    app.add_api_route("/__boom", boom)
    yield
    app.router.routes[:] = [r for r in app.router.routes if getattr(r, "path", "") != "/__boom"]


def test_unhandled_error_returns_500_without_leaking_details(boom_route):
    safe_client = TestClient(app, raise_server_exceptions=False)
    resp = safe_client.get("/__boom")
    body = assert_error(resp, 500, "internal_error")
    assert "segredo-interno" not in resp.text
    assert set(body) == {"detail", "code"}
