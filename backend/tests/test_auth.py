import bcrypt
import pytest
from datetime import datetime, timedelta, timezone

from app.core import security
from app.models.user import User
from tests.conftest import DEFAULT_PASSWORD, bearer, login_token, make_user, register


def test_first_user_becomes_admin(client):
    resp = register(client)
    assert resp.status_code == 201
    body = resp.json()
    assert body["is_admin"] is True
    assert "hashed_password" not in body


def test_register_without_invite_after_first_user_is_blocked(client):
    register(client)
    resp = register(client, email="outro@example.com")
    assert resp.status_code == 403


@pytest.mark.parametrize(
    "payload",
    [
        {"password": "curta"},
        {"password": "a" * 73},
        {"email": "nao-e-email"},
        {"name": ""},
    ],
)
def test_register_validation_returns_422(client, payload):
    body = {"name": "Admin", "email": "admin@example.com", "password": DEFAULT_PASSWORD, **payload}
    assert client.post("/api/v1/auth/register", json=body).status_code == 422


def test_password_is_stored_hashed(client, db_session):
    register(client)
    user = db_session.query(User).one()
    assert user.hashed_password != DEFAULT_PASSWORD
    assert bcrypt.checkpw(DEFAULT_PASSWORD.encode(), user.hashed_password.encode())


def test_login_returns_working_token(client):
    register(client)
    token = login_token(client)
    resp = client.get("/api/v1/auth/me", headers=bearer(token))
    assert resp.status_code == 200
    assert resp.json()["email"] == "admin@example.com"


def test_login_normalizes_email_case(client):
    register(client, email="Admin@Example.com")
    resp = client.post(
        "/api/v1/auth/login", json={"email": "ADMIN@example.COM", "password": DEFAULT_PASSWORD}
    )
    assert resp.status_code == 200


def test_login_wrong_password_and_unknown_email_look_the_same(client):
    register(client)
    wrong = client.post(
        "/api/v1/auth/login", json={"email": "admin@example.com", "password": "SenhaErrada1"}
    )
    unknown = client.post(
        "/api/v1/auth/login", json={"email": "ninguem@example.com", "password": "SenhaErrada1"}
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_login_runs_bcrypt_even_when_email_does_not_exist(client, monkeypatch):
    """Sem o bcrypt para email inexistente, o tempo de resposta revela quais emails existem."""
    register(client)
    calls = []
    real_checkpw = bcrypt.checkpw

    def spy(*args, **kwargs):
        calls.append(1)
        return real_checkpw(*args, **kwargs)

    monkeypatch.setattr(security.bcrypt, "checkpw", spy)
    client.post("/api/v1/auth/login", json={"email": "ninguem@example.com", "password": "SenhaErrada1"})
    assert len(calls) == 1


def test_account_locks_after_too_many_failures(client, db_session, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.max_failed_login_attempts", 3)
    register(client)
    for _ in range(3):
        resp = client.post(
            "/api/v1/auth/login", json={"email": "admin@example.com", "password": "SenhaErrada1"}
        )
        assert resp.status_code == 401

    # Mesmo com a senha certa a conta continua bloqueada
    resp = client.post(
        "/api/v1/auth/login", json={"email": "admin@example.com", "password": DEFAULT_PASSWORD}
    )
    assert resp.status_code == 423


def test_lock_expires_and_success_resets_counter(client, db_session, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.max_failed_login_attempts", 3)
    register(client)
    for _ in range(3):
        client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "SenhaErrada1"})

    user = db_session.query(User).one()
    user.locked_until = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()

    assert login_token(client)
    db_session.expire_all()
    user = db_session.query(User).one()
    assert user.failed_login_attempts == 0
    assert user.locked_until is None


def test_me_requires_valid_token(client):
    register(client)
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/auth/me", headers=bearer("lixo")).status_code == 401


def test_token_of_deleted_user_is_rejected(client, db_session):
    register(client)
    token = login_token(client)
    db_session.query(User).delete()
    db_session.commit()
    assert client.get("/api/v1/auth/me", headers=bearer(token)).status_code == 401


def test_token_signed_with_another_secret_is_rejected(client, db_session):
    register(client)
    user = db_session.query(User).one()
    import jwt

    forged = jwt.encode(
        {"sub": str(user.id), "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
        "outro-segredo-qualquer-com-tamanho-ok-12345",
        algorithm="HS256",
    )
    assert client.get("/api/v1/auth/me", headers=bearer(forged)).status_code == 401


def test_ids_are_uuid(client):
    import uuid

    body = register(client).json()
    assert uuid.UUID(body["id"])


def test_locked_user_token_is_rejected(client, db_session):
    register(client)
    token = login_token(client)
    user = db_session.query(User).one()
    user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=15)
    db_session.commit()
    assert client.get("/api/v1/auth/me", headers=bearer(token)).status_code == 401


def test_helper_make_user_creates_non_admin(db_session):
    user = make_user(db_session)
    assert user.is_admin is False
