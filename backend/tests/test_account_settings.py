"""Configuracoes da conta: PATCH /auth/me (nome e moeda padrao) e POST /auth/password."""

from app.core.config import settings
from app.models.user import User
from tests.conftest import DEFAULT_PASSWORD, bearer, login_token, register

NEW_PASSWORD = "OutraSenha456"


def patch_me(client, token, **body):
    return client.patch("/api/v1/auth/me", json=body, headers=bearer(token))


def change_password(client, token, current=DEFAULT_PASSWORD, new=NEW_PASSWORD):
    return client.post(
        "/api/v1/auth/password",
        json={"current_password": current, "new_password": new},
        headers=bearer(token),
    )


def setup(client):
    register(client)
    return login_token(client)


# ---------- Perfil ----------


def test_update_name(client):
    token = setup(client)
    resp = patch_me(client, token, name="Maria Souza")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Maria Souza"
    assert client.get("/api/v1/auth/me", headers=bearer(token)).json()["name"] == "Maria Souza"


def test_name_is_trimmed(client):
    token = setup(client)
    assert patch_me(client, token, name="  Maria  ").json()["name"] == "Maria"


def test_blank_name_is_refused(client):
    token = setup(client)
    assert patch_me(client, token, name="   ").status_code == 422


def test_name_limit(client):
    token = setup(client)
    assert patch_me(client, token, name="a" * 200).status_code == 200
    assert patch_me(client, token, name="a" * 201).status_code == 422


def test_update_currency(client):
    token = setup(client)
    resp = patch_me(client, token, default_currency="USD")
    assert resp.status_code == 200
    assert resp.json()["default_currency"] == "USD"


def test_currency_is_case_insensitive(client):
    token = setup(client)
    assert patch_me(client, token, default_currency="usd").json()["default_currency"] == "USD"


def test_unknown_currency_is_refused(client):
    token = setup(client)
    resp = patch_me(client, token, default_currency="ZZZ")
    assert resp.status_code == 400
    assert resp.json()["code"] == "currency_not_found"


def test_currency_must_have_three_letters(client):
    token = setup(client)
    assert patch_me(client, token, default_currency="US").status_code == 422
    assert patch_me(client, token, default_currency="USDD").status_code == 422


def test_missing_fields_do_not_change_anything(client):
    token = setup(client)
    patch_me(client, token, name="Maria", default_currency="USD")
    resp = patch_me(client, token)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Maria"
    assert resp.json()["default_currency"] == "USD"


def test_only_one_field_changes_only_that_field(client):
    token = setup(client)
    patch_me(client, token, name="Maria", default_currency="USD")
    assert patch_me(client, token, name="Ana").json()["default_currency"] == "USD"
    assert patch_me(client, token, default_currency="BRL").json()["name"] == "Ana"


def test_email_cannot_be_changed_here(client):
    token = setup(client)
    resp = patch_me(client, token, email="outro@example.com")
    assert resp.status_code == 200
    assert resp.json()["email"] == "admin@example.com"


def test_profile_requires_login(client):
    assert client.patch("/api/v1/auth/me", json={"name": "x"}).status_code == 401


def test_profile_refuses_api_token(client):
    token = setup(client)
    created = client.post("/api/v1/api-tokens", json={"name": "teste", "scope": "write"}, headers=bearer(token))
    raw = created.json()["token"]
    resp = patch_me(client, raw, name="Invasor")
    assert resp.status_code == 403
    assert resp.json()["code"] == "session_required"


def test_profile_only_touches_own_user(client, db_session):
    token = setup(client)
    other = client.post(
        "/api/v1/auth/register", json={"name": "Outro", "email": "o@example.com", "password": DEFAULT_PASSWORD}
    )
    assert other.status_code in (201, 403)  # sem convite o segundo cadastro nao entra
    patch_me(client, token, name="Maria")
    assert [u.name for u in db_session.query(User).all()] == ["Maria"]


# ---------- Senha ----------


def test_change_password_returns_working_token(client):
    token = setup(client)
    resp = change_password(client, token)
    assert resp.status_code == 200
    new_token = resp.json()["access_token"]
    assert client.get("/api/v1/auth/me", headers=bearer(new_token)).status_code == 200


def test_new_password_logs_in_and_old_one_does_not(client):
    token = setup(client)
    change_password(client, token)
    ok = client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": NEW_PASSWORD})
    old = client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": DEFAULT_PASSWORD})
    assert ok.status_code == 200
    assert old.status_code == 401


def test_other_sessions_stop_working_right_away(client):
    first = setup(client)
    second = login_token(client)
    change_password(client, first)
    for stale in (first, second):
        resp = client.get("/api/v1/auth/me", headers=bearer(stale))
        assert resp.status_code == 401
        assert resp.json()["code"] == "session_invalid"
    assert client.post("/api/v1/auth/refresh", headers=bearer(second)).status_code == 401


def test_wrong_current_password(client):
    token = setup(client)
    resp = change_password(client, token, current="SenhaErrada999")
    assert resp.status_code == 403
    assert resp.json()["code"] == "invalid_password"
    # A senha nao mudou
    assert client.post(
        "/api/v1/auth/login", json={"email": "admin@example.com", "password": DEFAULT_PASSWORD}
    ).status_code == 200


def test_wrong_current_password_counts_as_failed_attempt(client, db_session):
    token = setup(client)
    change_password(client, token, current="SenhaErrada999")
    db_session.expire_all()
    assert db_session.query(User).first().failed_login_attempts == 1


def test_repeated_wrong_current_password_locks_the_account(client, db_session):
    token = setup(client)
    for _ in range(settings.max_failed_login_attempts):
        change_password(client, token, current="SenhaErrada999")
    # Bloqueada, nem a sessao em uso passa mais
    resp = change_password(client, token)
    assert resp.status_code == 401
    assert resp.json()["code"] == "account_locked"


def test_same_password_is_refused(client):
    token = setup(client)
    resp = change_password(client, token, new=DEFAULT_PASSWORD)
    assert resp.status_code == 400
    assert resp.json()["code"] == "password_unchanged"


def test_short_new_password_is_refused(client):
    token = setup(client)
    assert change_password(client, token, new="curta").status_code == 422


def test_too_long_new_password_is_refused(client):
    token = setup(client)
    assert change_password(client, token, new="a" * 73).status_code == 422
    assert change_password(client, token, new="a" * 72).status_code == 200


def test_successful_change_clears_failed_attempts(client, db_session):
    token = setup(client)
    change_password(client, token, current="SenhaErrada999")
    change_password(client, token)
    db_session.expire_all()
    assert db_session.query(User).first().failed_login_attempts == 0


def test_password_requires_login(client):
    resp = client.post(
        "/api/v1/auth/password", json={"current_password": DEFAULT_PASSWORD, "new_password": NEW_PASSWORD}
    )
    assert resp.status_code == 401


def test_password_refuses_api_token(client):
    token = setup(client)
    raw = client.post("/api/v1/api-tokens", json={"name": "teste", "scope": "write"}, headers=bearer(token)).json()["token"]
    resp = change_password(client, raw)
    assert resp.status_code == 403
    assert resp.json()["code"] == "session_required"


def test_password_is_not_stored_in_clear(client, db_session):
    token = setup(client)
    change_password(client, token)
    stored = db_session.query(User).first().hashed_password
    assert NEW_PASSWORD not in stored
    assert stored.startswith("$")


def test_token_with_wrong_password_fingerprint_is_refused(client, db_session):
    """O token que carrega a impressao de outra senha nao vale, mesmo assinado e dentro do prazo."""
    import jwt

    setup(client)
    user = db_session.query(User).first()
    claims = {"sub": str(user.id), "typ": "access", "exp": 4102444800, "auth_at": 1, "pv": "00000000"}
    forged = jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    resp = client.get("/api/v1/auth/me", headers=bearer(forged))
    assert resp.status_code == 401
    assert resp.json()["code"] == "session_invalid"
