import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import settings

ACCESS_TYPE = "access"
CHALLENGE_TYPE = "2fa_challenge"
CHALLENGE_MINUTES = 5


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


# Hash valido que nao corresponde a nenhuma senha real. Serve so para gastar o mesmo tempo
# de bcrypt quando o email do login nao existe. Sem isso, "email nao existe" responde quase
# na hora e "senha errada" leva o tempo cheio, e dava para descobrir quais emails estao
# cadastrados so medindo o tempo de resposta.
_DUMMY_HASH = bcrypt.hashpw(b"dummy-password-for-constant-time-login", bcrypt.gensalt()).decode("utf-8")


def verify_password_constant_time(plain_password: str, hashed_password: str | None) -> bool:
    return bcrypt.checkpw(
        plain_password.encode("utf-8"), (hashed_password or _DUMMY_HASH).encode("utf-8")
    )


def password_fingerprint(hashed_password: str | None) -> str:
    """Impressao curta do hash da senha atual, guardada no token. Trocar a senha muda a
    impressao e a renovacao de sessao recusa os tokens de antes da troca. Nao expoe a senha
    nem o hash (so 8 caracteres de um SHA-256 do hash)."""
    return hashlib.sha256((hashed_password or "").encode("utf-8")).hexdigest()[:8]


def create_access_token(
    subject: str,
    auth_at: datetime | None = None,
    password_hash: str | None = None,
) -> str:
    """`auth_at` e o momento do login original e atravessa as renovacoes (sessao deslizante):
    e ele que limita a duracao total da sessao. `password_hash` gera a impressao usada para
    cortar a renovacao quando a senha muda."""
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": subject,
        "typ": ACCESS_TYPE,
        "exp": expire,
        "auth_at": int((auth_at or now).timestamp()),
        "pv": password_fingerprint(password_hash),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    claims = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    # Token do passo 1 do 2FA (typ diferente) nunca vale como token de acesso. Tokens de
    # acesso antigos nao tem `typ`, entao a ausencia conta como acesso.
    if claims.get("typ", ACCESS_TYPE) != ACCESS_TYPE:
        raise jwt.InvalidTokenError("tipo de token invalido")
    return claims


def create_challenge_token(subject: str, password_hash: str | None) -> str:
    """Token de curta duracao entregue depois da senha correta, quando a conta tem 2FA. So serve
    para chamar /auth/2fa/verify. `pv` invalida o desafio se a senha mudar no meio."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "typ": CHALLENGE_TYPE,
        "exp": now + timedelta(minutes=CHALLENGE_MINUTES),
        "pv": password_fingerprint(password_hash),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_challenge_token(token: str) -> dict:
    claims = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    if claims.get("typ") != CHALLENGE_TYPE:
        raise jwt.InvalidTokenError("tipo de token invalido")
    return claims


def generate_invite_token() -> str:
    return secrets.token_urlsafe(32)


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def parse_user_id(value: str) -> uuid.UUID:
    return uuid.UUID(value)
