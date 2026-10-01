from datetime import datetime, timedelta, timezone

from app.models.user import Invite, User
from tests.conftest import bearer, login_token, make_user, register


def admin_headers(client) -> dict:
    register(client)
    return bearer(login_token(client))


def create_invite(client, headers, email="novo@example.com"):
    return client.post("/api/v1/invites", json={"email": email}, headers=headers)


def test_admin_creates_invite_and_token_is_shown_once(client, db_session):
    headers = admin_headers(client)
    resp = create_invite(client, headers)
    assert resp.status_code == 201
    token = resp.json()["token"]

    # No banco fica so o hash, nunca o token
    invite = db_session.query(Invite).one()
    assert invite.token_hash != token

    listing = client.get("/api/v1/invites", headers=headers).json()
    assert len(listing) == 1
    assert "token" not in listing[0]


def test_non_admin_cannot_manage_invites(client, db_session):
    register(client)
    make_user(db_session, email="comum@example.com")
    headers = bearer(login_token(client, email="comum@example.com"))
    assert create_invite(client, headers).status_code == 403
    assert client.get("/api/v1/invites", headers=headers).status_code == 403


def test_invites_require_login(client):
    assert client.post("/api/v1/invites", json={"email": "a@example.com"}).status_code == 401


def test_register_with_invite_creates_non_admin(client):
    headers = admin_headers(client)
    token = create_invite(client, headers).json()["token"]

    resp = register(client, email="novo@example.com", invite_token=token)

    assert resp.status_code == 201
    assert resp.json()["is_admin"] is False


def test_invite_cannot_be_reused(client):
    headers = admin_headers(client)
    token = create_invite(client, headers).json()["token"]
    assert register(client, email="novo@example.com", invite_token=token).status_code == 201

    again = register(client, email="novo@example.com", invite_token=token)
    assert again.status_code == 403


def test_invite_only_works_for_its_email(client):
    headers = admin_headers(client)
    token = create_invite(client, headers).json()["token"]
    resp = register(client, email="outro@example.com", invite_token=token)
    assert resp.status_code == 403


def test_expired_invite_is_rejected(client, db_session):
    headers = admin_headers(client)
    token = create_invite(client, headers).json()["token"]
    invite = db_session.query(Invite).one()
    invite.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()

    assert register(client, email="novo@example.com", invite_token=token).status_code == 403


def test_revoked_invite_is_rejected(client):
    headers = admin_headers(client)
    created = create_invite(client, headers).json()
    assert client.delete(f"/api/v1/invites/{created['id']}", headers=headers).status_code == 204

    resp = register(client, email="novo@example.com", invite_token=created["token"])
    assert resp.status_code == 403


def test_garbage_invite_token_is_rejected(client):
    admin_headers(client)
    assert register(client, email="novo@example.com", invite_token="lixo").status_code == 403


def test_cannot_invite_existing_user(client):
    headers = admin_headers(client)
    resp = create_invite(client, headers, email="admin@example.com")
    assert resp.status_code == 400


def test_failed_registration_does_not_burn_the_invite(client):
    """Convite so e marcado como usado quando o usuario e criado de verdade."""
    headers = admin_headers(client)
    token = create_invite(client, headers).json()["token"]

    # Senha invalida falha na validacao antes de tocar no convite
    bad = register(client, email="novo@example.com", password="curta", invite_token=token)
    assert bad.status_code == 422

    assert register(client, email="novo@example.com", invite_token=token).status_code == 201


def test_revoke_unknown_invite_returns_404(client):
    import uuid

    headers = admin_headers(client)
    assert client.delete(f"/api/v1/invites/{uuid.uuid4()}", headers=headers).status_code == 404


def test_first_user_is_the_only_admin(client, db_session):
    headers = admin_headers(client)
    token = create_invite(client, headers).json()["token"]
    register(client, email="novo@example.com", invite_token=token)
    assert db_session.query(User).filter(User.is_admin.is_(True)).count() == 1
