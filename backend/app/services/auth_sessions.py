"""Sessoes de login: criar, renovar a chave (com rotacao), encerrar e listar. O cookie de renovacao e uma chave
aleatoria de 256 bits; no banco fica so o hash. Quem chama cuida do cookie e das respostas."""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Response
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.auth_session import AuthSession

REFRESH_COOKIE = "peculio_refresh"
COOKIE_PATH = "/api/v1/auth"
# Cabecalho que o app manda ao restaurar e ao sair. Um site de fora nao consegue manda-lo sem uma checagem previa do
# navegador, o que fecha a porta para pedidos forjados mesmo que o cookie viaje.
CLIENT_HEADER = "x-requested-with"
CLIENT_HEADER_VALUE = "peculio"
# Sessoes encerradas ou vencidas ha mais que isso saem do banco
KEEP_DEAD_SESSIONS_DAYS = 7


def _now() -> datetime:
    """Hora real. Nao usa o relogio do app (app.core.clock), que os testes e o E2E podem mover: a validade de uma sessao
    e seguranca e nao pode andar junto com uma data simulada."""
    return datetime.now(timezone.utc)


def hash_refresh(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_refresh_token() -> str:
    # 256 bits aleatorios: impossivel de adivinhar, entao um hash simples basta
    return secrets.token_urlsafe(32)


# ---------- Nome do aparelho ----------

_BROWSERS = [("Edg/", "Edge"), ("EdgA/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"), ("FxiOS/", "Firefox"),
             ("CriOS/", "Chrome"), ("Chrome/", "Chrome"), ("Safari/", "Safari")]
_SYSTEMS = [("Android", "Android"), ("iPhone", "iOS"), ("iPad", "iOS"), ("CrOS", "ChromeOS"), ("Windows", "Windows"),
            ("Macintosh", "macOS"), ("Mac OS X", "macOS"), ("Linux", "Linux"), ("X11", "Linux")]


def device_label(user_agent: str | None) -> str:
    """"Chrome no Windows": so o que a pessoa precisa para reconhecer o aparelho. Nao guarda o texto inteiro do
    navegador nem o endereco IP."""
    agent = user_agent or ""
    browser = next((name for marker, name in _BROWSERS if marker in agent), None)
    system = next((name for marker, name in _SYSTEMS if marker in agent), None)
    if browser and system:
        return f"{browser} no {system}"
    return browser or (f"Navegador no {system}" if system else "Aparelho desconhecido")


# ---------- Cookie ----------


def set_refresh_cookie(response: Response, raw: str, remember: bool) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=raw,
        # Sem "Manter conectado" o cookie e de sessao: o navegador o apaga ao fechar
        max_age=settings.session_remember_days * 86400 if remember else None,
        httponly=True,
        samesite="strict",
        secure=settings.cookie_secure,
        path=COOKIE_PATH,
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=REFRESH_COOKIE, path=COOKIE_PATH, httponly=True, samesite="strict", secure=settings.cookie_secure)


# ---------- Ciclo de vida ----------


def _expiry(now: datetime, remember: bool) -> datetime:
    if remember:
        return now + timedelta(days=settings.session_remember_days)
    return now + timedelta(hours=settings.session_idle_hours)


def create(db: Session, user_id: uuid.UUID, user_agent: str | None, remember: bool) -> tuple[AuthSession, str]:
    """Abre uma sessao e devolve ela com a chave de renovacao em texto (a unica vez que ela existe fora do hash)."""
    now = _now()
    # Limpeza preguicosa: sessao morta ha mais de uma semana nao serve a ninguem
    db.execute(
        delete(AuthSession).where(
            AuthSession.user_id == user_id,
            (AuthSession.revoked_at < now - timedelta(days=KEEP_DEAD_SESSIONS_DAYS))
            | (AuthSession.expires_at < now - timedelta(days=KEEP_DEAD_SESSIONS_DAYS)),
        )
    )
    raw = new_refresh_token()
    session = AuthSession(
        user_id=user_id,
        refresh_hash=hash_refresh(raw),
        remember=remember,
        device_label=device_label(user_agent),
        created_at=now,
        last_used_at=now,
        expires_at=_expiry(now, remember),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session, raw


def parse_session_id(value: object) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


def is_active(session: AuthSession | None, now: datetime) -> bool:
    return session is not None and session.revoked_at is None and session.expires_at > now


def get_active(db: Session, session_id: uuid.UUID, user_id: uuid.UUID) -> AuthSession | None:
    session = db.get(AuthSession, session_id)
    if session is None or session.user_id != user_id:
        return None
    return session if is_active(session, _now()) else None


def touch(db: Session, session: AuthSession) -> None:
    """A pessoa usou o app: a sessao vive mais (30 dias com "Manter conectado", 12 horas sem uso senao)."""
    now = _now()
    session.last_used_at = now
    session.expires_at = _expiry(now, session.remember)
    db.commit()


class InvalidRefresh(Exception):
    """Cookie ausente, desconhecido, vencido ou ja encerrado."""


def rotate(db: Session, raw: str) -> tuple[AuthSession, str | None]:
    """Troca a chave de renovacao. Devolve a sessao e a chave nova; a chave e None quando o pedido caiu na tolerancia
    de uma aba que chegou junto com outra (a outra ja trouxe o cookie novo)."""
    now = _now()
    current_hash = hash_refresh(raw)

    session = db.execute(
        select(AuthSession).where(AuthSession.refresh_hash == current_hash).with_for_update()
    ).scalar_one_or_none()
    if session is not None:
        if not is_active(session, now):
            raise InvalidRefresh
        fresh = new_refresh_token()
        session.previous_hash = current_hash
        session.refresh_hash = hash_refresh(fresh)
        session.rotated_at = now
        session.last_used_at = now
        session.expires_at = _expiry(now, session.remember)
        db.commit()
        return session, fresh

    old = db.execute(
        select(AuthSession).where(AuthSession.previous_hash == current_hash).with_for_update()
    ).scalar_one_or_none()
    if old is None:
        raise InvalidRefresh
    if (
        is_active(old, now)
        and old.rotated_at is not None
        and now - old.rotated_at <= timedelta(seconds=settings.refresh_grace_seconds)
    ):
        return old, None
    # Uma chave que ja foi trocada voltou fora da tolerancia: alguem guardou o cookie. Encerra a sessao inteira.
    if old.revoked_at is None:
        old.revoked_at = now
        db.commit()
    raise InvalidRefresh


def revoke_by_cookie(db: Session, raw: str) -> None:
    now = _now()
    h = hash_refresh(raw)
    db.execute(
        update(AuthSession)
        .where((AuthSession.refresh_hash == h) | (AuthSession.previous_hash == h), AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.commit()


def revoke(db: Session, session: AuthSession) -> None:
    if session.revoked_at is None:
        session.revoked_at = _now()
        db.commit()


def revoke_all_except(db: Session, user_id: uuid.UUID, keep: uuid.UUID | None) -> int:
    """Encerra as sessoes ativas da pessoa, menos `keep`. Devolve quantas encerrou."""
    now = _now()
    stmt = (
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None), AuthSession.expires_at > now)
        .values(revoked_at=now)
    )
    if keep is not None:
        stmt = stmt.where(AuthSession.id != keep)
    count = db.execute(stmt).rowcount
    db.commit()
    return count


def list_active(db: Session, user_id: uuid.UUID) -> list[AuthSession]:
    now = _now()
    return list(
        db.execute(
            select(AuthSession)
            .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None), AuthSession.expires_at > now)
            .order_by(AuthSession.last_used_at.desc())
        ).scalars()
    )

