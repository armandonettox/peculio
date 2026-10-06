"""Manter conectado: sessao no servidor, cookie de renovacao HttpOnly com rotacao, lista de aparelhos e encerramento."""

from datetime import timedelta

import jwt
import pytest
from fastapi.testclient import TestClient

from app.core import clock
from app.core.config import settings
from app.main import app
from app.models.auth_session import AuthSession
from app.models.user import User
from app.services.auth_sessions import REFRESH_COOKIE, device_label, hash_refresh
from tests.conftest import DEFAULT_PASSWORD, bearer, make_user, register
from tests.test_two_factor import code_in, enable_2fa, first_step, verify

API = "/api/v1/auth"
CLIENT = {"X-Requested-With": "peculio"}
CHROME_WIN = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"


def login(client, remember=False, email="admin@example.com", password=DEFAULT_PASSWORD, agent=CHROME_WIN):
    return client.post(
        f"{API}/login",
        json={"email": email, "password": password, "remember": remember},
        headers={"User-Agent": agent},
    )


def restore(client, headers=CLIENT):
    return client.post(f"{API}/session", headers=headers)


def claims(token):
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


def cookie_header(response):
    """O Set-Cookie do cookie de renovacao, em minusculo para comparar atributos."""
    values = [v for v in response.headers.get_list("set-cookie") if v.startswith(f"{REFRESH_COOKIE}=")]
    return values[0].lower() if values else None


def second_browser():
    """Outro navegador: cookies proprios."""
    return TestClient(app)


@pytest.fixture
def admin(client):
    register(client)
    return client


# ---------- Nome do aparelho ----------


@pytest.mark.parametrize(
    "agent, expected",
    [
        (CHROME_WIN, "Chrome no Windows"),
        (FIREFOX_LINUX, "Firefox no Linux"),
        (CHROME_WIN + " Edg/130.0", "Edge no Windows"),
        (CHROME_WIN + " OPR/115.0", "Opera no Windows"),
        ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1", "Safari no iOS"),
        ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit CriOS/130.0 Safari/604.1", "Chrome no iOS"),
        ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", "Chrome no Android"),
        ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", "Safari no macOS"),
        ("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "Chrome no ChromeOS"),
        ("Mozilla/5.0 (Windows NT 10.0)", "Navegador no Windows"),
        ("curl/8.0", "Aparelho desconhecido"),
        ("", "Aparelho desconhecido"),
        (None, "Aparelho desconhecido"),
    ],
)
def test_device_label(agent, expected):
    assert device_label(agent) == expected


# ---------- Login cria a sessao e o cookie ----------


def test_login_sets_a_session_cookie_that_javascript_cannot_read(admin):
    response = login(admin)
    assert response.status_code == 200
    cookie = cookie_header(response)
    assert cookie is not None
    assert "httponly" in cookie
    assert "samesite=strict" in cookie
    assert "path=/api/v1/auth" in cookie
    # Sem "Manter conectado": cookie de sessao, o navegador apaga ao fechar
    assert "max-age" not in cookie and "expires" not in cookie


def test_remember_makes_the_cookie_last_30_days(admin):
    cookie = cookie_header(login(admin, remember=True))
    assert f"max-age={30 * 86400}" in cookie


def test_the_cookie_is_secure_when_the_installation_is_on_https(admin, monkeypatch):
    monkeypatch.setattr(settings, "cookie_secure", True)
    assert "secure" in cookie_header(login(admin)).split("; ")
    monkeypatch.setattr(settings, "cookie_secure", False)
    assert "secure" not in cookie_header(login(admin)).split("; ")


def test_login_token_is_tied_to_a_session(admin, db_session):
    token = login(admin).json()["access_token"]
    session = db_session.query(AuthSession).one()
    assert claims(token)["sid"] == str(session.id)
    assert admin.get(f"{API}/me", headers=bearer(token)).status_code == 200


def test_the_session_keeps_only_the_hash_and_a_short_device_name(admin, db_session):
    response = login(admin, agent=CHROME_WIN)
    raw = admin.cookies.get(REFRESH_COOKIE)
    session = db_session.query(AuthSession).one()
    assert session.refresh_hash == hash_refresh(raw)
    assert raw not in session.refresh_hash and len(raw) >= 40
    assert session.device_label == "Chrome no Windows"
    assert response.status_code == 200


def test_remember_is_stored_and_sets_the_lifetime(admin, db_session):
    login(admin, remember=True)
    login(second_browser(), remember=False)
    rows = {row.remember: row for row in db_session.query(AuthSession).all()}
    now = clock.utc_now()
    assert timedelta(days=29) < rows[True].expires_at - now <= timedelta(days=30)
    assert timedelta(hours=11) < rows[False].expires_at - now <= timedelta(hours=12)


def test_a_wrong_password_creates_no_session_or_cookie(admin, db_session):
    response = login(admin, password="SenhaErrada000")
    assert response.status_code == 401
    assert cookie_header(response) is None
    assert db_session.query(AuthSession).count() == 0


def test_two_factor_login_creates_the_session_after_the_second_step(client, db_session):
    _, secret, _ = enable_2fa(client)
    # O helper ja entrou uma vez para ativar o 2FA
    before = db_session.query(AuthSession).count()
    step1 = client.post(f"{API}/login", json={"email": "admin@example.com", "password": DEFAULT_PASSWORD, "remember": True})
    assert step1.json()["two_factor_required"] is True
    # Ainda sem sessao nem cookie: so a senha nao basta
    assert cookie_header(step1) is None
    assert db_session.query(AuthSession).count() == before

    resp = client.post(
        f"{API}/2fa/verify",
        json={"challenge_token": step1.json()["challenge_token"], "code": code_in(secret, 1), "remember": True},
    )
    assert resp.status_code == 200
    assert f"max-age={30 * 86400}" in cookie_header(resp)
    assert db_session.query(AuthSession).count() == before + 1
    session = db_session.get(AuthSession, claims(resp.json()["access_token"])["sid"])
    assert session is not None and session.remember is True


def test_two_factor_login_without_remember_gives_a_session_cookie(client):
    _, secret, _ = enable_2fa(client)
    challenge = first_step(client).json()["challenge_token"]
    resp = verify(client, challenge, code_in(secret, 1))
    assert resp.status_code == 200
    assert "max-age" not in cookie_header(resp)


# ---------- Restaurar a sessao ----------


def test_restore_gives_a_new_working_token_for_the_same_session(admin, db_session):
    first = login(admin).json()["access_token"]
    resp = restore(admin)
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    assert claims(token)["sid"] == claims(first)["sid"]
    assert admin.get(f"{API}/me", headers=bearer(token)).status_code == 200


def test_restore_replaces_the_refresh_key_every_time(admin):
    login(admin)
    before = admin.cookies.get(REFRESH_COOKIE)
    resp = restore(admin)
    after = admin.cookies.get(REFRESH_COOKIE)
    assert after and after != before
    assert cookie_header(resp) is not None


def test_restore_keeps_the_cookie_kind_of_the_session(admin):
    login(admin, remember=True)
    assert f"max-age={30 * 86400}" in cookie_header(restore(admin))
    other = second_browser()
    login(other, remember=False)
    assert "max-age" not in cookie_header(restore(other))


def test_restore_without_a_cookie_is_refused_and_clears_nothing_useful(admin):
    resp = restore(second_browser())
    assert resp.status_code == 401
    assert resp.json()["code"] == "session_invalid"


@pytest.mark.parametrize("headers", [{}, {"X-Requested-With": "outro"}, {"X-Requested-With": ""}])
def test_restore_needs_the_app_header(admin, headers):
    login(admin)
    resp = restore(admin, headers=headers)
    assert resp.status_code == 403
    assert resp.json()["code"] == "client_header_missing"


def test_restore_with_a_garbage_cookie_is_refused_and_the_cookie_is_cleared(admin):
    browser = second_browser()
    browser.cookies.set(REFRESH_COOKIE, "isto-nao-e-uma-chave", path="/api/v1/auth")
    resp = restore(browser)
    assert resp.status_code == 401
    assert "max-age=0" in cookie_header(resp)


def test_restore_of_an_expired_session_is_refused(admin, db_session):
    login(admin)
    session = db_session.query(AuthSession).one()
    session.expires_at = clock.utc_now() - timedelta(seconds=1)
    db_session.commit()
    resp = restore(admin)
    assert resp.status_code == 401
    assert resp.json()["code"] == "session_invalid"


def test_restore_of_a_revoked_session_is_refused(admin, db_session):
    login(admin)
    session = db_session.query(AuthSession).one()
    session.revoked_at = clock.utc_now()
    db_session.commit()
    assert restore(admin).status_code == 401


def test_restore_slides_the_expiry(admin, db_session):
    login(admin, remember=True)
    session = db_session.query(AuthSession).one()
    session.expires_at = clock.utc_now() + timedelta(days=1)
    db_session.commit()
    restore(admin)
    db_session.expire_all()
    assert db_session.query(AuthSession).one().expires_at - clock.utc_now() > timedelta(days=29)


def test_restore_of_a_locked_account_is_refused(admin, db_session):
    login(admin)
    user = db_session.query(User).one()
    user.locked_until = clock.utc_now() + timedelta(minutes=10)
    db_session.commit()
    resp = restore(admin)
    assert resp.status_code == 423
    assert resp.json()["code"] == "account_locked"


# ---------- Roubo de cookie: chave velha que volta ----------


def test_an_old_key_used_right_after_is_tolerated_for_two_tabs(admin):
    login(admin)
    old = admin.cookies.get(REFRESH_COOKIE)
    restore(admin)  # a primeira aba trocou a chave
    new = admin.cookies.get(REFRESH_COOKIE)

    # A segunda aba chega com a chave que acabou de ser trocada
    other = second_browser()
    other.cookies.set(REFRESH_COOKIE, old, path="/api/v1/auth")
    resp = restore(other)
    assert resp.status_code == 200
    # Ela nao ganha chave nova: a que vale e a que a primeira aba ja recebeu
    assert cookie_header(resp) is None
    assert admin.cookies.get(REFRESH_COOKIE) == new
    assert restore(admin).status_code == 200


def test_an_old_key_after_the_tolerance_kills_the_whole_session(admin, db_session):
    login(admin)
    old = admin.cookies.get(REFRESH_COOKIE)
    restore(admin)
    session = db_session.query(AuthSession).one()
    session.rotated_at = clock.utc_now() - timedelta(seconds=settings.refresh_grace_seconds + 5)
    db_session.commit()

    thief = second_browser()
    thief.cookies.set(REFRESH_COOKIE, old, path="/api/v1/auth")
    assert restore(thief).status_code == 401

    # A chave nova da pessoa de verdade tambem deixou de valer: a sessao foi encerrada
    db_session.expire_all()
    assert db_session.query(AuthSession).one().revoked_at is not None
    assert restore(admin).status_code == 401


def test_tolerance_ends_exactly_after_the_configured_seconds(admin, db_session, monkeypatch):
    monkeypatch.setattr(settings, "refresh_grace_seconds", 0)
    login(admin)
    old = admin.cookies.get(REFRESH_COOKIE)
    restore(admin)
    other = second_browser()
    other.cookies.set(REFRESH_COOKIE, old, path="/api/v1/auth")
    assert restore(other).status_code == 401


# ---------- A sessao derruba o token ----------


def test_ending_the_session_kills_its_access_token_at_once(admin, db_session):
    token = login(admin).json()["access_token"]
    assert admin.get(f"{API}/me", headers=bearer(token)).status_code == 200
    session = db_session.query(AuthSession).one()
    session.revoked_at = clock.utc_now()
    db_session.commit()
    resp = admin.get(f"{API}/me", headers=bearer(token))
    assert resp.status_code == 401
    assert resp.json()["code"] == "session_invalid"


def test_an_expired_session_kills_its_access_token(admin, db_session):
    token = login(admin).json()["access_token"]
    session = db_session.query(AuthSession).one()
    session.expires_at = clock.utc_now() - timedelta(seconds=1)
    db_session.commit()
    assert admin.get(f"{API}/me", headers=bearer(token)).status_code == 401


def test_a_token_with_an_unknown_or_garbage_session_is_refused(admin, db_session):
    import uuid

    user = db_session.query(User).one()
    for sid in (str(uuid.uuid4()), "isto-nao-e-um-id", 123):
        forged = jwt.encode(
            {"sub": str(user.id), "typ": "access", "exp": 4102444800, "auth_at": 1, "sid": sid},
            settings.jwt_secret,
            algorithm=settings.jwt_algorithm,
        )
        assert admin.get(f"{API}/me", headers=bearer(forged)).status_code == 401, sid


def test_a_token_cannot_borrow_another_persons_session(admin, db_session):
    login(admin)
    mine = db_session.query(AuthSession).one()
    other_user = make_user(db_session, email="outra@example.com")
    forged = jwt.encode(
        {"sub": str(other_user.id), "typ": "access", "exp": 4102444800, "auth_at": 1, "sid": str(mine.id)},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    assert admin.get(f"{API}/me", headers=bearer(forged)).status_code == 401


def test_the_apps_simulated_clock_does_not_expire_sessions(admin, monkeypatch):
    """O relogio do app pode ser movido (testes, E2E): a validade da sessao segue a hora real, nao ele."""
    from datetime import datetime, timezone

    token = login(admin).json()["access_token"]
    monkeypatch.setattr(clock, "utc_now", lambda: datetime(2040, 1, 1, tzinfo=timezone.utc))
    assert admin.get(f"{API}/me", headers=bearer(token)).status_code == 200
    assert restore(admin).status_code == 200


def test_refresh_by_token_keeps_the_session_and_extends_it(admin, db_session):
    token = login(admin, remember=True).json()["access_token"]
    session = db_session.query(AuthSession).one()
    session.expires_at = clock.utc_now() + timedelta(days=1)
    db_session.commit()
    resp = admin.post(f"{API}/refresh", headers=bearer(token))
    assert resp.status_code == 200
    assert claims(resp.json()["access_token"])["sid"] == claims(token)["sid"]
    db_session.expire_all()
    assert db_session.query(AuthSession).one().expires_at - clock.utc_now() > timedelta(days=29)


# ---------- Lista e encerramento de aparelhos ----------


def test_listing_requires_login(client):
    assert client.get(f"{API}/sessions").status_code == 401


def test_listing_shows_my_devices_with_the_current_one_marked(admin):
    mine = login(admin, agent=CHROME_WIN).json()["access_token"]
    other = second_browser()
    login(other, agent=FIREFOX_LINUX)

    rows = admin.get(f"{API}/sessions", headers=bearer(mine)).json()
    assert {row["device_label"] for row in rows} == {"Chrome no Windows", "Firefox no Linux"}
    current = [row for row in rows if row["current"]]
    assert len(current) == 1 and current[0]["device_label"] == "Chrome no Windows"


def test_listing_never_exposes_keys_or_addresses(admin):
    token = login(admin).json()["access_token"]
    row = admin.get(f"{API}/sessions", headers=bearer(token)).json()[0]
    assert set(row) == {"id", "device_label", "remember", "created_at", "last_used_at", "expires_at", "current"}


def test_listing_hides_ended_and_expired_sessions(admin, db_session):
    token = login(admin).json()["access_token"]
    other = second_browser()
    login(other)
    dead = second_browser()
    login(dead)
    sessions = db_session.query(AuthSession).order_by(AuthSession.created_at).all()
    sessions[1].revoked_at = clock.utc_now()
    sessions[2].expires_at = clock.utc_now() - timedelta(seconds=1)
    db_session.commit()
    assert len(admin.get(f"{API}/sessions", headers=bearer(token)).json()) == 1


def test_listing_hides_other_peoples_sessions(admin, db_session):
    make_user(db_session, email="outra@example.com")
    stranger = second_browser()
    login(stranger, email="outra@example.com")
    token = login(admin).json()["access_token"]
    assert len(admin.get(f"{API}/sessions", headers=bearer(token)).json()) == 1


def test_ending_one_device(admin, db_session):
    token = login(admin).json()["access_token"]
    other = second_browser()
    other_token = login(other).json()["access_token"]
    other_id = claims(other_token)["sid"]

    assert admin.delete(f"{API}/sessions/{other_id}", headers=bearer(token)).status_code == 204
    assert other.get(f"{API}/me", headers=bearer(other_token)).status_code == 401
    assert restore(other).status_code == 401
    # O meu segue
    assert admin.get(f"{API}/me", headers=bearer(token)).status_code == 200
    assert len(admin.get(f"{API}/sessions", headers=bearer(token)).json()) == 1


def test_ending_an_unknown_or_ended_session_is_404(admin):
    import uuid

    token = login(admin).json()["access_token"]
    resp = admin.delete(f"{API}/sessions/{uuid.uuid4()}", headers=bearer(token))
    assert resp.status_code == 404
    assert resp.json()["code"] == "session_not_found"
    own = claims(token)["sid"]
    assert admin.delete(f"{API}/sessions/{own}", headers=bearer(token)).status_code == 204
    # Ja encerrada: o token dela caiu, e nem chega a procurar
    assert admin.delete(f"{API}/sessions/{own}", headers=bearer(token)).status_code == 401


def test_a_person_cannot_end_someone_elses_session(admin, db_session):
    make_user(db_session, email="outra@example.com")
    stranger = second_browser()
    stranger_token = login(stranger, email="outra@example.com").json()["access_token"]
    victim = claims(stranger_token)["sid"]
    token = login(admin).json()["access_token"]
    resp = admin.delete(f"{API}/sessions/{victim}", headers=bearer(token))
    assert resp.status_code == 404
    assert stranger.get(f"{API}/me", headers=bearer(stranger_token)).status_code == 200


def test_ending_all_other_devices_keeps_this_one(admin):
    token = login(admin).json()["access_token"]
    others = [second_browser(), second_browser()]
    other_tokens = [login(o).json()["access_token"] for o in others]

    resp = admin.delete(f"{API}/sessions", headers=bearer(token))
    assert resp.status_code == 200
    assert resp.json() == {"revoked": 2}
    for browser, other_token in zip(others, other_tokens):
        assert browser.get(f"{API}/me", headers=bearer(other_token)).status_code == 401
    assert admin.get(f"{API}/me", headers=bearer(token)).status_code == 200


def test_session_routes_refuse_api_tokens(admin):
    token = login(admin).json()["access_token"]
    raw = admin.post("/api/v1/api-tokens", json={"name": "t", "scope": "write"}, headers=bearer(token)).json()["token"]
    for method, path in (("get", "/sessions"), ("delete", "/sessions")):
        resp = getattr(admin, method)(f"{API}{path}", headers=bearer(raw))
        assert resp.status_code == 403
        assert resp.json()["code"] == "session_required"


# ---------- Sair ----------


def test_logout_ends_the_session_clears_the_cookie_and_kills_the_token(admin, db_session):
    token = login(admin).json()["access_token"]
    resp = admin.post(f"{API}/logout", headers={**CLIENT, **bearer(token)})
    assert resp.status_code == 204
    assert "max-age=0" in cookie_header(resp)
    assert db_session.query(AuthSession).one().revoked_at is not None
    assert admin.get(f"{API}/me", headers=bearer(token)).status_code == 401
    assert restore(admin).status_code == 401


def test_logout_works_from_the_cookie_alone(admin, db_session):
    login(admin)
    assert admin.post(f"{API}/logout", headers=CLIENT).status_code == 204
    assert db_session.query(AuthSession).one().revoked_at is not None


def test_logout_works_from_the_token_alone(admin, db_session):
    """Aba sem o cookie (outro navegador com o token): sair encerra a sessao do token."""
    token = login(admin).json()["access_token"]
    no_cookie = second_browser()
    resp = no_cookie.post(f"{API}/logout", headers={**CLIENT, **bearer(token)})
    assert resp.status_code == 204
    assert db_session.query(AuthSession).one().revoked_at is not None
    assert admin.get(f"{API}/me", headers=bearer(token)).status_code == 401


def test_logout_needs_the_app_header(admin, db_session):
    login(admin)
    resp = admin.post(f"{API}/logout")
    assert resp.status_code == 403
    assert db_session.query(AuthSession).one().revoked_at is None


def test_logout_with_nothing_to_end_is_fine(client):
    assert client.post(f"{API}/logout", headers=CLIENT).status_code == 204


def test_logout_does_not_touch_other_devices(admin):
    token = login(admin).json()["access_token"]
    other = second_browser()
    other_token = login(other).json()["access_token"]
    admin.post(f"{API}/logout", headers={**CLIENT, **bearer(token)})
    assert other.get(f"{API}/me", headers=bearer(other_token)).status_code == 200


# ---------- Trocar a senha ----------


def test_changing_the_password_ends_the_other_devices_but_not_this_one(admin):
    token = login(admin, remember=True).json()["access_token"]
    other = second_browser()
    other_token = login(other, remember=True).json()["access_token"]

    resp = admin.post(
        f"{API}/password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": "OutraSenha456"},
        headers=bearer(token),
    )
    assert resp.status_code == 200
    new_token = resp.json()["access_token"]

    # Este aparelho continua: o token novo e o cookie valem
    assert admin.get(f"{API}/me", headers=bearer(new_token)).status_code == 200
    assert claims(new_token)["sid"] == claims(token)["sid"]
    assert restore(admin).status_code == 200
    # O outro caiu por inteiro: token e cookie
    assert other.get(f"{API}/me", headers=bearer(other_token)).status_code == 401
    assert restore(other).status_code == 401


# ---------- Limpeza ----------


def test_old_dead_sessions_are_cleaned_up_on_the_next_login(admin, db_session):
    login(admin)
    session = db_session.query(AuthSession).one()
    session.revoked_at = clock.utc_now() - timedelta(days=8)
    db_session.commit()
    other = second_browser()
    login(other)
    db_session.expire_all()
    assert db_session.query(AuthSession).count() == 1


def test_recently_ended_sessions_are_kept_for_a_while(admin, db_session):
    login(admin)
    session = db_session.query(AuthSession).one()
    session.revoked_at = clock.utc_now() - timedelta(days=2)
    db_session.commit()
    login(second_browser())
    db_session.expire_all()
    assert db_session.query(AuthSession).count() == 2


def test_deleting_the_user_removes_their_sessions(admin, db_session):
    login(admin)
    db_session.delete(db_session.query(User).one())
    db_session.commit()
    assert db_session.query(AuthSession).count() == 0
