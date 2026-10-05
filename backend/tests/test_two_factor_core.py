import pyotp

from app.core import two_factor as tf

SECRET = "JBSWY3DPEHPK3PXP"
NOW = 1_800_000_000.0


def code_at(offset_steps: int = 0, now: float = NOW) -> str:
    return pyotp.TOTP(SECRET).at((tf.current_step(now) + offset_steps) * tf.TOTP_STEP_SECONDS)


def test_current_code_is_accepted_and_returns_its_step():
    assert tf.verify_totp(SECRET, code_at(0), None, now=NOW) == tf.current_step(NOW)


def test_wrong_code_is_rejected():
    wrong = "000000" if code_at(0) != "000000" else "111111"
    assert tf.verify_totp(SECRET, wrong, None, now=NOW) is None


def test_window_accepts_one_step_each_side_but_not_two():
    assert tf.verify_totp(SECRET, code_at(-1), None, now=NOW) == tf.current_step(NOW) - 1
    assert tf.verify_totp(SECRET, code_at(1), None, now=NOW) == tf.current_step(NOW) + 1
    assert tf.verify_totp(SECRET, code_at(-2), None, now=NOW) is None
    assert tf.verify_totp(SECRET, code_at(2), None, now=NOW) is None


def test_same_step_cannot_be_used_twice():
    step = tf.verify_totp(SECRET, code_at(0), None, now=NOW)
    assert tf.verify_totp(SECRET, code_at(0), step, now=NOW) is None


def test_older_step_than_the_last_used_is_rejected_but_a_newer_one_passes():
    last = tf.current_step(NOW)
    assert tf.verify_totp(SECRET, code_at(-1), last, now=NOW) is None
    assert tf.verify_totp(SECRET, code_at(1), last, now=NOW) == last + 1


def test_secret_round_trips_encrypted():
    token = tf.encrypt_secret(SECRET)
    assert SECRET not in token
    assert tf.decrypt_secret(token) == SECRET


def test_secret_does_not_open_with_another_key(monkeypatch):
    token = tf.encrypt_secret(SECRET)
    monkeypatch.setattr(tf.settings, "encryption_key", "outra-chave-de-teste-com-mais-de-32-caracteres")
    assert tf.decrypt_secret(token) is None


def test_decrypt_of_garbage_is_none_not_an_error():
    assert tf.decrypt_secret("isto-nao-e-um-token") is None


def test_provisioning_uri_names_the_app_and_the_account():
    uri = tf.provisioning_uri(SECRET, "ana@example.com")
    assert uri.startswith("otpauth://totp/")
    assert "Pec%C3%BAlio" in uri
    assert "ana%40example.com" in uri
    assert f"secret={SECRET}" in uri


def test_generated_secret_is_valid_base32_and_different_each_time():
    first, second = tf.generate_totp_secret(), tf.generate_totp_secret()
    assert first != second
    assert pyotp.TOTP(first).now().isdigit()


def test_recovery_codes_are_unique_and_formatted():
    codes = tf.generate_recovery_codes()
    assert len(codes) == tf.RECOVERY_CODE_COUNT
    assert len(set(codes)) == len(codes)
    for code in codes:
        left, right = code.split("-")
        assert len(left) == len(right) == 6


def test_recovery_hash_ignores_case_spaces_and_hyphen():
    assert tf.hash_recovery_code("ABCDEF-123456") == tf.hash_recovery_code(" abcdef 123456 ")
    assert tf.hash_recovery_code("abcdef-123456") != tf.hash_recovery_code("abcdef-123457")


def test_looks_like_totp_tells_six_digits_from_a_recovery_code():
    assert tf.looks_like_totp("123456")
    assert tf.looks_like_totp("123 456")
    assert not tf.looks_like_totp("12345")
    assert not tf.looks_like_totp("abcdef-123456")
    assert not tf.looks_like_totp("12345a")
