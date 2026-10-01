import time
from datetime import datetime, timedelta, timezone

import jwt
import pyotp
import pytest

from app.core import two_factor
from app.core.config import settings
from app.core.security import hash_password
from app.models.user import RecoveryCode, User
from tests.conftest import DEFAULT_PASSWORD, auth_headers, bearer, make_user, register

URL = "/api/v1/auth"


def code_in(secret: str, steps: int = 0) -> str:
    """Codigo do app daqui a `steps` passos de 30 s. O passo atual ja pode ter sido gasto."""
    return pyotp.TOTP(secret).at(time.time() + 30 * steps)


def enable_2fa(client, email="admin@example.com"):
    """Registra (se preciso), ativa o 2FA e devolve (cabecalho, segredo, codigos de recuperacao)."""
    register(client, email=email)
    headers = auth_headers(client, email=email)
    secret = client.post(f"{URL}/2fa/setup", headers=headers).json()["secret"]
    resp = client.post(f"{URL}/2fa/enable", headers=headers, json={"code": code_in(secret)})
    assert resp.status_code == 200, resp.text
    return headers, secret, resp.json()["recovery_codes"]


def first_step(client, email="admin@example.com", password=DEFAULT_PASSWORD):
    return client.post(f"{URL}/login", json={"email": email, "password": password})


def verify(client, challenge, code):
    return client.post(f"{URL}/2fa/verify", json={"challenge_token": challenge, "code": code})


# ---------- Ativar ----------


def test_setup_requires_login(client):
    assert client.post(f"{URL}/2fa/setup").status_code == 401
    assert client.post(f"{URL}/2fa/enable", json={"code": "123456"}).status_code == 401
    assert client.get(f"{URL}/2fa/status").status_code == 401


def test_setup_returns_secret_and_uri_and_stores_it_encrypted_and_inactive(client, db_session):
    register(client)
    body = client.post(f"{URL}/2fa/setup", headers=auth_headers(client)).json()

    assert body["otpauth_url"].startswith("otpauth://totp/")
    assert body["secret"] in body["otpauth_url"]
    user = db_session.query(User).one()
    assert user.totp_enabled is False
    assert user.totp_secret_encrypted and body["secret"] not in user.totp_secret_encrypted
    assert two_factor.decrypt_secret(user.totp_secret_encrypted) == body["secret"]


def test_setup_again_before_enabling_replaces_the_secret(client):
    register(client)
    headers = auth_headers(client)
    first = client.post(f"{URL}/2fa/setup", headers=headers).json()["secret"]
    second = client.post(f"{URL}/2fa/setup", headers=headers).json()["secret"]
    assert first != second
    # O segredo antigo nao ativa mais
    assert client.post(f"{URL}/2fa/enable", headers=headers, json={"code": code_in(first)}).status_code == 401
    assert client.post(f"{URL}/2fa/enable", headers=headers, json={"code": code_in(second)}).status_code == 200


def test_enable_without_setup_is_refused(client):
    register(client)
    resp = client.post(f"{URL}/2fa/enable", headers=auth_headers(client), json={"code": "123456"})
    assert resp.status_code == 400
    assert resp.json()["code"] == "two_factor_setup_required"


@pytest.mark.parametrize("code", ["000000", "abc", "12345", "abcdef-123456"])
def test_enable_with_a_wrong_code_keeps_it_off(client, db_session, code):
    register(client)
    headers = auth_headers(client)
    secret = client.post(f"{URL}/2fa/setup", headers=headers).json()["secret"]
    if code == code_in(secret):
        pytest.skip("o codigo de exemplo coincidiu com o real")
    resp = client.post(f"{URL}/2fa/enable", headers=headers, json={"code": code})
    assert resp.status_code == 401
    assert resp.json()["code"] == "two_factor_invalid_code"
    assert db_session.query(User).one().totp_enabled is False


def test_enable_returns_ten_unique_recovery_codes_stored_only_as_hashes(client, db_session):
    _, _, codes = enable_2fa(client)
    assert len(codes) == 10 and len(set(codes)) == 10

    stored = {row.code_hash for row in db_session.query(RecoveryCode).all()}
    assert stored == {two_factor.hash_recovery_code(c) for c in codes}
    assert not any(c in h for c in codes for h in stored)
    assert db_session.query(User).one().totp_enabled is True


def test_setup_and_enable_are_refused_once_enabled(client):
    headers, secret, _ = enable_2fa(client)
    assert client.post(f"{URL}/2fa/setup", headers=headers).status_code == 409
    resp = client.post(f"{URL}/2fa/enable", headers=headers, json={"code": code_in(secret, 1)})
    assert resp.status_code == 409
    assert resp.json()["code"] == "two_factor_already_enabled"


def test_status_shows_enabled_and_remaining_codes(client):
    register(client)
    headers = auth_headers(client)
    assert client.get(f"{URL}/2fa/status", headers=headers).json() == {"enabled": False, "recovery_codes_remaining": 0}
    secret = client.post(f"{URL}/2fa/setup", headers=headers).json()["secret"]
    client.post(f"{URL}/2fa/enable", headers=headers, json={"code": code_in(secret)})
    assert client.get(f"{URL}/2fa/status", headers=headers).json() == {"enabled": True, "recovery_codes_remaining": 10}


# ---------- Login em dois passos ----------


def test_login_without_2fa_still_returns_the_access_token(client):
    register(client)
    body = first_step(client).json()
    assert body["two_factor_required"] is False
    assert body["access_token"]
    assert body["challenge_token"] is None


def test_login_with_2fa_returns_only_a_challenge(client):
    enable_2fa(client)
    body = first_step(client).json()
    assert body["two_factor_required"] is True
    assert body["challenge_token"]
    assert body["access_token"] is None


def test_wrong_password_does_not_reveal_the_2fa_step(client):
    enable_2fa(client)
    resp = first_step(client, password="SenhaErrada999")
    assert resp.status_code == 401
    assert resp.json()["code"] == "invalid_credentials"
    assert "challenge_token" not in resp.json()


def test_the_challenge_cannot_be_used_as_an_access_token(client):
    enable_2fa(client)
    challenge = first_step(client).json()["challenge_token"]
    assert client.get(f"{URL}/me", headers=bearer(challenge)).status_code == 401
    assert client.post(f"{URL}/refresh", headers=bearer(challenge)).status_code == 401
    assert client.get("/api/v1/accounts", headers=bearer(challenge)).status_code == 401


def test_an_access_token_cannot_be_used_as_a_challenge(client):
    headers, secret, _ = enable_2fa(client)
    access = headers["Authorization"].removeprefix("Bearer ")
    resp = verify(client, access, code_in(secret, 1))
    assert resp.status_code == 401
    assert resp.json()["code"] == "two_factor_challenge_invalid"


def test_verify_with_the_app_code_returns_a_working_token(client):
    _, secret, _ = enable_2fa(client)
    challenge = first_step(client).json()["challenge_token"]
    resp = verify(client, challenge, code_in(secret, 1))
    assert resp.status_code == 200
    assert client.get(f"{URL}/me", headers=bearer(resp.json()["access_token"])).json()["email"] == "admin@example.com"


def test_the_same_code_cannot_be_used_twice(client):
    _, secret, _ = enable_2fa(client)
    code = code_in(secret, 1)
    assert verify(client, first_step(client).json()["challenge_token"], code).status_code == 200
    again = verify(client, first_step(client).json()["challenge_token"], code)
    assert again.status_code == 401
    assert again.json()["code"] == "two_factor_invalid_code"


def test_the_code_used_to_enable_cannot_log_in_right_after(client):
    # enable_2fa gasta o codigo do passo atual
    _, secret, _ = enable_2fa(client)
    resp = verify(client, first_step(client).json()["challenge_token"], code_in(secret, 0))
    assert resp.status_code == 401


def test_code_accepts_spaces(client):
    _, secret, _ = enable_2fa(client)
    code = code_in(secret, 1)
    resp = verify(client, first_step(client).json()["challenge_token"], f"{code[:3]} {code[3:]}")
    assert resp.status_code == 200


def test_a_recovery_code_logs_in_once(client):
    headers, _, codes = enable_2fa(client)
    ok = verify(client, first_step(client).json()["challenge_token"], codes[0].upper())
    assert ok.status_code == 200
    assert client.get(f"{URL}/2fa/status", headers=headers).json()["recovery_codes_remaining"] == 9

    again = verify(client, first_step(client).json()["challenge_token"], codes[0])
    assert again.status_code == 401
    # E outro codigo ainda funciona
    assert verify(client, first_step(client).json()["challenge_token"], codes[1]).status_code == 200


def test_a_wrong_code_is_refused(client):
    _, secret, _ = enable_2fa(client)
    wrong = "000000" if code_in(secret, 1) != "000000" else "111111"
    resp = verify(client, first_step(client).json()["challenge_token"], wrong)
    assert resp.status_code == 401
    assert resp.json()["code"] == "two_factor_invalid_code"


def test_a_garbage_challenge_is_refused(client):
    enable_2fa(client)
    resp = verify(client, "isto-nao-e-um-token", "123456")
    assert resp.status_code == 401
    assert resp.json()["code"] == "two_factor_challenge_invalid"


def test_an_expired_challenge_is_refused(client, db_session):
    _, secret, _ = enable_2fa(client)
    user = db_session.query(User).one()
    expired = jwt.encode(
        {
            "sub": str(user.id),
            "typ": "2fa_challenge",
            "exp": datetime.now(timezone.utc) - timedelta(seconds=1),
            "pv": "x",
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    assert verify(client, expired, code_in(secret, 1)).json()["code"] == "two_factor_challenge_invalid"


def test_changing_the_password_invalidates_an_open_challenge(client, db_session):
    _, secret, _ = enable_2fa(client)
    challenge = first_step(client).json()["challenge_token"]
    user = db_session.query(User).one()
    user.hashed_password = hash_password("OutraSenha456")
    db_session.commit()
    resp = verify(client, challenge, code_in(secret, 1))
    assert resp.status_code == 401
    assert resp.json()["code"] == "two_factor_challenge_invalid"


def test_the_challenge_does_not_work_after_2fa_is_turned_off(client):
    headers, secret, _ = enable_2fa(client)
    challenge = first_step(client).json()["challenge_token"]
    client.post(f"{URL}/2fa/disable", headers=headers, json={"password": DEFAULT_PASSWORD, "code": code_in(secret, 1)})
    resp = verify(client, challenge, code_in(secret, 2))
    assert resp.json()["code"] == "two_factor_challenge_invalid"


# ---------- Trava por tentativas ----------


def test_wrong_codes_lock_the_account_like_wrong_passwords(client):
    _, secret, _ = enable_2fa(client)
    challenge = first_step(client).json()["challenge_token"]
    wrong = "000000" if code_in(secret, 1) != "000000" else "111111"
    statuses = [verify(client, challenge, wrong).status_code for _ in range(settings.max_failed_login_attempts)]
    assert statuses == [401] * settings.max_failed_login_attempts

    # Trancada: nem o codigo certo entra, nem o login de senha
    locked = verify(client, challenge, code_in(secret, 1))
    assert locked.status_code == 423
    assert locked.json()["code"] == "account_locked"
    assert first_step(client).status_code == 423


def test_a_good_second_step_resets_the_failure_counter(client, db_session):
    _, secret, _ = enable_2fa(client)
    challenge = first_step(client).json()["challenge_token"]
    wrong = "000000" if code_in(secret, 1) != "000000" else "111111"
    for _ in range(3):
        verify(client, challenge, wrong)
    assert db_session.query(User).one().failed_login_attempts == 3
    assert verify(client, challenge, code_in(secret, 1)).status_code == 200
    db_session.expire_all()
    assert db_session.query(User).one().failed_login_attempts == 0


def test_a_password_only_login_does_not_reset_the_counter_when_2fa_is_on(client, db_session):
    _, secret, _ = enable_2fa(client)
    challenge = first_step(client).json()["challenge_token"]
    wrong = "000000" if code_in(secret, 1) != "000000" else "111111"
    verify(client, challenge, wrong)
    first_step(client)  # senha certa, mas ainda falta o segundo passo
    db_session.expire_all()
    assert db_session.query(User).one().failed_login_attempts == 1


# ---------- Desligar e novos codigos ----------


def test_disable_needs_password_and_code(client, db_session):
    headers, secret, codes = enable_2fa(client)

    bad_password = client.post(f"{URL}/2fa/disable", headers=headers, json={"password": "errada", "code": code_in(secret, 1)})
    assert bad_password.status_code == 403
    assert bad_password.json()["code"] == "invalid_password"

    bad_code = client.post(f"{URL}/2fa/disable", headers=headers, json={"password": DEFAULT_PASSWORD, "code": "000000"})
    assert bad_code.status_code == 401
    assert db_session.query(User).one().totp_enabled is True

    ok = client.post(f"{URL}/2fa/disable", headers=headers, json={"password": DEFAULT_PASSWORD, "code": code_in(secret, 1)})
    assert ok.status_code == 204
    db_session.expire_all()
    user = db_session.query(User).one()
    assert user.totp_enabled is False and user.totp_secret_encrypted is None and user.totp_last_step is None
    assert db_session.query(RecoveryCode).count() == 0
    # Volta ao login de um passo
    assert first_step(client).json()["access_token"]


def test_disable_with_a_recovery_code(client):
    headers, _, codes = enable_2fa(client)
    resp = client.post(f"{URL}/2fa/disable", headers=headers, json={"password": DEFAULT_PASSWORD, "code": codes[0]})
    assert resp.status_code == 204


def test_disable_when_not_enabled_is_refused(client):
    register(client)
    resp = client.post(
        f"{URL}/2fa/disable", headers=auth_headers(client), json={"password": DEFAULT_PASSWORD, "code": "123456"}
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "two_factor_not_enabled"


def test_regenerate_replaces_all_recovery_codes(client):
    headers, secret, old = enable_2fa(client)
    resp = client.post(
        f"{URL}/2fa/recovery-codes", headers=headers, json={"password": DEFAULT_PASSWORD, "code": code_in(secret, 1)}
    )
    assert resp.status_code == 200
    new = resp.json()["recovery_codes"]
    assert len(new) == 10 and not set(new) & set(old)

    assert verify(client, first_step(client).json()["challenge_token"], old[0]).status_code == 401
    assert verify(client, first_step(client).json()["challenge_token"], new[0]).status_code == 200
    assert client.get(f"{URL}/2fa/status", headers=headers).json()["recovery_codes_remaining"] == 9


def test_regenerate_needs_password_and_code(client):
    headers, secret, _ = enable_2fa(client)
    assert (
        client.post(f"{URL}/2fa/recovery-codes", headers=headers, json={"password": "errada", "code": code_in(secret, 1)}).status_code
        == 403
    )
    assert (
        client.post(f"{URL}/2fa/recovery-codes", headers=headers, json={"password": DEFAULT_PASSWORD, "code": "000000"}).status_code
        == 401
    )


# ---------- Isolamento ----------


def test_2fa_of_one_user_does_not_affect_another(client, db_session):
    enable_2fa(client)
    make_user(db_session, email="outro@example.com")
    body = first_step(client, email="outro@example.com").json()
    assert body["two_factor_required"] is False and body["access_token"]


def test_a_recovery_code_of_one_user_does_not_open_another_account(client, db_session):
    _, _, codes = enable_2fa(client)
    make_user(db_session, email="outro@example.com")
    other_headers = auth_headers(client, email="outro@example.com")
    other_secret = client.post(f"{URL}/2fa/setup", headers=other_headers).json()["secret"]
    client.post(f"{URL}/2fa/enable", headers=other_headers, json={"code": code_in(other_secret)})
    challenge = first_step(client, email="outro@example.com").json()["challenge_token"]
    assert verify(client, challenge, codes[0]).status_code == 401


def test_access_tokens_carry_the_access_type(client):
    register(client)
    claims = jwt.decode(
        first_step(client).json()["access_token"], settings.jwt_secret, algorithms=[settings.jwt_algorithm]
    )
    assert claims["typ"] == "access"


def test_a_legacy_access_token_without_typ_still_works(client, db_session):
    register(client)
    user = db_session.query(User).one()
    legacy = jwt.encode(
        {"sub": str(user.id), "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    assert client.get(f"{URL}/me", headers=bearer(legacy)).status_code == 200
