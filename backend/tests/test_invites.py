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
    assert listing["total"] == 1
    assert "token" not in listing["items"][0]


def common_headers(client, db_session, email="comum@example.com"):
    """Cabecalho de uma pessoa que nao e administradora (o administrador e o primeiro cadastro)."""
    make_user(db_session, email=email)
    return bearer(login_token(client, email=email))


def test_non_admin_can_invite_and_the_invite_belongs_to_them(client, db_session):
    register(client)
    headers = common_headers(client, db_session)

    created = create_invite(client, headers, email="amigo@example.com")
    assert created.status_code == 201

    owner = db_session.query(User).filter(User.email == "comum@example.com").one()
    assert db_session.query(Invite).one().created_by == owner.id
    # E a pessoa convidada entra e nao vira administradora
    resp = register(client, email="amigo@example.com", invite_token=created.json()["token"])
    assert resp.status_code == 201
    assert resp.json()["is_admin"] is False


def test_non_admin_sees_only_their_own_invites_and_admin_sees_all(client, db_session):
    admin = admin_headers(client)
    common = common_headers(client, db_session)
    other = common_headers(client, db_session, email="outra@example.com")
    create_invite(client, admin, email="do-admin@example.com")
    create_invite(client, common, email="da-comum@example.com")
    create_invite(client, other, email="da-outra@example.com")

    mine = client.get("/api/v1/invites", headers=common).json()
    assert [item["email"] for item in mine["items"]] == ["da-comum@example.com"]
    assert mine["total"] == 1

    everyone = client.get("/api/v1/invites", headers=admin).json()
    assert everyone["total"] == 3


def test_non_admin_cannot_renew_or_revoke_someone_elses_invite(client, db_session):
    admin = admin_headers(client)
    common = common_headers(client, db_session)
    theirs = create_invite(client, admin, email="do-admin@example.com").json()

    # Responde como se nao existisse, para nao revelar convites de outras pessoas
    assert client.post(f"/api/v1/invites/{theirs['id']}/renew", headers=common).status_code == 404
    assert client.delete(f"/api/v1/invites/{theirs['id']}", headers=common).status_code == 404
    assert db_session.query(Invite).count() == 1


def test_non_admin_renews_and_revokes_their_own_invite(client, db_session):
    register(client)
    common = common_headers(client, db_session)
    created = create_invite(client, common, email="amigo@example.com").json()

    renewed = client.post(f"/api/v1/invites/{created['id']}/renew", headers=common)
    assert renewed.status_code == 200
    assert renewed.json()["token"] != created["token"]
    assert client.delete(f"/api/v1/invites/{created['id']}", headers=common).status_code == 204
    assert db_session.query(Invite).count() == 0


def test_admin_can_revoke_an_invite_created_by_someone_else(client, db_session):
    admin = admin_headers(client)
    common = common_headers(client, db_session)
    created = create_invite(client, common, email="amigo@example.com").json()
    assert client.delete(f"/api/v1/invites/{created['id']}", headers=admin).status_code == 204


def test_non_admin_has_a_limit_of_pending_invites_and_admin_does_not(client, db_session):
    from app.routers.invites import MAX_PENDING_INVITES_PER_USER

    admin = admin_headers(client)
    common = common_headers(client, db_session)
    for number in range(MAX_PENDING_INVITES_PER_USER):
        assert create_invite(client, common, email=f"pessoa{number}@example.com").status_code == 201

    blocked = create_invite(client, common, email="uma-a-mais@example.com")
    assert blocked.status_code == 400
    assert blocked.json()["code"] == "invite_limit_reached"
    # Revogar um libera espaco
    first = client.get("/api/v1/invites?limit=1", headers=common).json()["items"][0]
    assert client.delete(f"/api/v1/invites/{first['id']}", headers=common).status_code == 204
    assert create_invite(client, common, email="uma-a-mais@example.com").status_code == 201
    # O administrador nao tem teto
    for number in range(MAX_PENDING_INVITES_PER_USER + 1):
        assert create_invite(client, admin, email=f"adm{number}@example.com").status_code == 201


def test_used_and_expired_invites_do_not_count_toward_the_limit(client, db_session):
    from app.routers.invites import MAX_PENDING_INVITES_PER_USER

    register(client)
    common = common_headers(client, db_session)
    for number in range(MAX_PENDING_INVITES_PER_USER):
        create_invite(client, common, email=f"pessoa{number}@example.com")
    now = datetime.now(timezone.utc)
    invites = db_session.query(Invite).order_by(Invite.email).all()
    invites[0].used_at = now
    invites[1].expires_at = now - timedelta(minutes=1)
    db_session.commit()

    # Duas vagas abertas: uma por convite usado e outra por convite vencido
    assert create_invite(client, common, email="vaga1@example.com").status_code == 201
    assert create_invite(client, common, email="vaga2@example.com").status_code == 201
    assert create_invite(client, common, email="vaga3@example.com").status_code == 400


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
