"""Sessao deslizante: POST /auth/refresh troca um token ainda valido por um novo, sem novo
login. Precisa respeitar usuario apagado, conta bloqueada, teto absoluto da sessao e troca
de senha."""

from datetime import datetime, timedelta, timezone

import jwt

from app.core import security
from app.core.config import settings
from app.models.user import User
from tests.conftest import bearer, login_token, register


def claims(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


def refresh(client, token: str):
    return client.post("/api/v1/auth/refresh", headers=bearer(token))


def make_token(db_session, **kwargs) -> str:
    """Token montado como o servidor monta, com o hash da senha do usuario real. Senao a
    impressao da senha nao bate e a renovacao recusa, corretamente."""
    user = db_session.query(User).first()
    return security.create_access_token(
        subject=str(user.id), password_hash=user.hashed_password, **kwargs
    )


def test_refresh_returns_new_working_token(client):
    register(client)
    resp = refresh(client, login_token(client))
    assert resp.status_code == 200
    new = resp.json()["access_token"]
    assert client.get("/api/v1/auth/me", headers=bearer(new)).status_code == 200


def test_refresh_extends_validity(client, db_session):
    register(client)
    almost = claims(make_token(db_session))
    almost["exp"] = int((datetime.now(timezone.utc) + timedelta(minutes=2)).timestamp())
    almost_token = jwt.encode(almost, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    new = refresh(client, almost_token).json()["access_token"]

    remaining = claims(new)["exp"] - datetime.now(timezone.utc).timestamp()
    assert remaining > (settings.access_token_expire_minutes - 1) * 60


def test_refresh_keeps_original_login_time(client):
    """A renovacao nao pode zerar o teto da sessao: auth_at continua sendo o do login."""
    register(client)
    old = login_token(client)
    auth_at = claims(old)["auth_at"]

    new = refresh(client, old).json()["access_token"]
    newer = refresh(client, new).json()["access_token"]

    assert claims(new)["auth_at"] == auth_at
    assert claims(newer)["auth_at"] == auth_at


def test_refresh_requires_token(client):
    assert client.post("/api/v1/auth/refresh").status_code == 401
    assert refresh(client, "lixo").status_code == 401


def test_refresh_rejects_session_past_absolute_limit(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "session_max_hours", 24)
    register(client)
    old = make_token(db_session, auth_at=datetime.now(timezone.utc) - timedelta(hours=25))

    resp = refresh(client, old)

    assert resp.status_code == 401
    # Precisa ser o teto (expirada), nao a impressao da senha (invalida)
    assert "expirada" in resp.json()["detail"].lower()


def test_refresh_within_limit_works(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "session_max_hours", 24)
    register(client)
    token = make_token(db_session, auth_at=datetime.now(timezone.utc) - timedelta(hours=23))
    assert refresh(client, token).status_code == 200


def test_zero_limit_disables_the_cap(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "session_max_hours", 0)
    register(client)
    token = make_token(db_session, auth_at=datetime.now(timezone.utc) - timedelta(days=400))
    assert refresh(client, token).status_code == 200


def test_refresh_of_deleted_user_returns_401(client, db_session):
    register(client)
    token = login_token(client)
    db_session.query(User).delete()
    db_session.commit()
    assert refresh(client, token).status_code == 401


def test_refresh_of_locked_account_returns_401(client, db_session):
    register(client)
    token = login_token(client)
    user = db_session.query(User).first()
    user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=15)
    db_session.commit()
    assert refresh(client, token).status_code == 401


def test_changing_password_cuts_refresh(client, db_session):
    """Depois de trocar a senha, um token roubado nao pode continuar se renovando."""
    register(client)
    token = login_token(client)
    assert refresh(client, token).status_code == 200

    user = db_session.query(User).first()
    user.hashed_password = security.hash_password("OutraSenha456")
    db_session.commit()

    resp = refresh(client, token)
    assert resp.status_code == 401
    assert "invalida" in resp.json()["detail"].lower()


def test_login_token_has_session_claims(client):
    register(client)
    data = claims(login_token(client))
    assert "auth_at" in data and "pv" in data
