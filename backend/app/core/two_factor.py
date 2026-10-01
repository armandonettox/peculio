import base64
import hashlib
import hmac
import secrets
import time

import pyotp
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

# Passo do TOTP padrao (RFC 6238) e quantos passos para cada lado aceitamos, para tolerar
# relogio do celular um pouco fora de hora
TOTP_STEP_SECONDS = 30
TOTP_WINDOW = 1
ISSUER = "finance-app"
RECOVERY_CODE_COUNT = 10


def _fernet() -> Fernet:
    # A chave do Fernet precisa ter 32 bytes em base64; derivamos da ENCRYPTION_KEY (texto livre)
    digest = hashlib.sha256(settings.encryption_key.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_secret(token: str) -> str | None:
    """None se o valor nao abre com a chave atual (chave trocada ou dado corrompido)."""
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(secret: str, account_name: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account_name, issuer_name=ISSUER)


def current_step(now: float | None = None) -> int:
    return int((time.time() if now is None else now) // TOTP_STEP_SECONDS)


def verify_totp(secret: str, code: str, last_step: int | None, now: float | None = None) -> int | None:
    """Devolve o passo do codigo aceito, ou None. Recusa passo ja usado (last_step) e anteriores:
    o mesmo codigo nao vale duas vezes, mesmo dentro da janela de 30 segundos."""
    totp = pyotp.TOTP(secret, interval=TOTP_STEP_SECONDS)
    base = current_step(now)
    accepted: int | None = None
    # Percorre a janela inteira, sem parar no primeiro acerto, para o tempo nao denunciar o passo
    for offset in range(-TOTP_WINDOW, TOTP_WINDOW + 1):
        step = base + offset
        if hmac.compare_digest(totp.at(step * TOTP_STEP_SECONDS), code) and (
            last_step is None or step > last_step
        ):
            accepted = step
    return accepted


# ---------- Codigos de recuperacao ----------


def normalize_code(value: str) -> str:
    return value.replace(" ", "").replace("-", "").strip().lower()


def looks_like_totp(value: str) -> bool:
    normalized = normalize_code(value)
    return len(normalized) == 6 and normalized.isdigit()


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    """Formato xxxxxx-xxxxxx (12 caracteres hexadecimais, 48 bits)."""
    codes = []
    for _ in range(count):
        raw = secrets.token_hex(6)
        codes.append(f"{raw[:6]}-{raw[6:]}")
    return codes


def hash_recovery_code(code: str) -> str:
    # SHA-256 basta: o codigo tem 48 bits aleatorios, e a tentativa por minuto e limitada
    return hashlib.sha256(normalize_code(code).encode("utf-8")).hexdigest()
