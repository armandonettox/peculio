import hashlib
import secrets
import time
import uuid
from collections import defaultdict, deque
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import clock
from app.core.config import settings
from app.core.errors import AppError, ErrorCode
from app.core.pagination import PageParams, paginate
from app.models.api_token import ApiToken, ApiTokenScope
from app.models.user import User
from app.schemas.api_token import ApiTokenCreate

TOKEN_PREFIX = "fin_"
# Quantos caracteres do token (contando "fin_") ficam visiveis na lista
PREFIX_LENGTH = 12
MAX_TOKENS_PER_USER = 10
# A ultima data de uso so e regravada se a anterior tem mais que isto
LAST_USED_GRANULARITY = timedelta(minutes=1)
RATE_WINDOW_SECONDS = 60.0


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_token_value() -> str:
    """fin_ mais 43 caracteres aleatorios (256 bits): impossivel de adivinhar, entao um hash simples basta."""
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def is_expired(token: ApiToken) -> bool:
    return token.expires_at is not None and token.expires_at <= clock.utc_now()


def to_output(token: ApiToken) -> dict:
    return {
        "id": token.id,
        "name": token.name,
        "prefix": token.prefix,
        "scope": token.scope,
        "expires_at": token.expires_at,
        "last_used_at": token.last_used_at,
        "created_at": token.created_at,
        "expired": is_expired(token),
    }


# ---------- Gerenciar (so pela tela) ----------


def get_owned_token(db: Session, user_id: uuid.UUID, token_id: uuid.UUID) -> ApiToken:
    """404 tambem quando e de outro usuario, para nao revelar que existe."""
    token = db.execute(select(ApiToken).where(ApiToken.id == token_id, ApiToken.user_id == user_id)).scalar_one_or_none()
    if not token:
        raise AppError(404, ErrorCode.API_TOKEN_NOT_FOUND, "Token nao encontrado")
    return token


def create_token(db: Session, user: User, data: ApiTokenCreate) -> tuple[ApiToken, str]:
    """Cria o token e devolve ele junto com o valor completo, que e a unica vez que existe fora do hash."""
    count = db.scalar(select(func.count()).select_from(ApiToken).where(ApiToken.user_id == user.id))
    if count >= MAX_TOKENS_PER_USER:
        raise AppError(
            409,
            ErrorCode.API_TOKEN_LIMIT_REACHED,
            f"Voce chegou ao limite de {MAX_TOKENS_PER_USER} tokens. Revogue algum para criar outro",
        )
    taken = db.scalar(
        select(ApiToken.id).where(ApiToken.user_id == user.id, func.lower(ApiToken.name) == data.name.lower())
    )
    if taken:
        raise AppError(409, ErrorCode.API_TOKEN_NAME_TAKEN, "Ja existe um token com esse nome")

    value = new_token_value()
    token = ApiToken(
        user_id=user.id,
        name=data.name,
        token_hash=hash_token(value),
        prefix=value[:PREFIX_LENGTH],
        scope=data.scope,
        expires_at=None if data.expires_in_days is None else clock.utc_now() + timedelta(days=data.expires_in_days),
    )
    db.add(token)
    db.flush()
    db.refresh(token)
    return token, value


def list_tokens(db: Session, user_id: uuid.UUID, params: PageParams) -> dict:
    statement = select(ApiToken).where(ApiToken.user_id == user_id).order_by(ApiToken.created_at.desc(), ApiToken.id)
    page = paginate(db, statement, params)
    page["items"] = [to_output(item) for item in page["items"]]
    return page


def revoke_token(db: Session, token: ApiToken) -> None:
    db.delete(token)
    db.flush()


# ---------- Usar ----------


def authenticate(db: Session, raw: str) -> ApiToken:
    """O token que corresponde ao valor, se ainda vale. Valor desconhecido ou revogado e o mesmo erro de um
    token invalido; vencido tem o proprio erro, para a pessoa saber que precisa criar outro."""
    token = db.execute(select(ApiToken).where(ApiToken.token_hash == hash_token(raw))).scalar_one_or_none()
    if token is None:
        raise AppError(401, ErrorCode.TOKEN_INVALID, "Token invalido", {"WWW-Authenticate": "Bearer"})
    if is_expired(token):
        raise AppError(401, ErrorCode.API_TOKEN_EXPIRED, "Token vencido: crie outro", {"WWW-Authenticate": "Bearer"})
    return token


def allows_method(token: ApiToken, method: str) -> bool:
    """Leitura so deixa consultar; escrita deixa tudo. Qualquer metodo fora de GET, HEAD e OPTIONS e escrita."""
    return token.scope == ApiTokenScope.write or method.upper() in ("GET", "HEAD", "OPTIONS")


def needs_last_used_update(token: ApiToken) -> bool:
    return token.last_used_at is None or clock.utc_now() - token.last_used_at >= LAST_USED_GRANULARITY


class TokenRateLimiter:
    """Janela deslizante de 60 s por token, na memoria do processo. Quem passa do limite espera a janela andar."""

    def __init__(self) -> None:
        self._hits: dict[uuid.UUID, deque[float]] = defaultdict(deque)

    def allow(self, token_id: uuid.UUID, limit: int, now: float | None = None) -> bool:
        moment = time.monotonic() if now is None else now
        hits = self._hits[token_id]
        while hits and moment - hits[0] >= RATE_WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(moment)
        return True

    def forget(self, token_id: uuid.UUID) -> None:
        self._hits.pop(token_id, None)

    def reset(self) -> None:
        self._hits.clear()


rate_limiter = TokenRateLimiter()


def within_rate_limit(token: ApiToken) -> bool:
    if not settings.rate_limit_enabled:
        return True
    return rate_limiter.allow(token.id, settings.api_token_rate_per_minute)
