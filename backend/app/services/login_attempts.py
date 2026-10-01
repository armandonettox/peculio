from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError, ErrorCode
from app.models.user import User


def ensure_not_locked(user: User | None) -> None:
    if user and user.locked_until and user.locked_until > datetime.now(timezone.utc):
        raise AppError(
            423, ErrorCode.ACCOUNT_LOCKED, "Conta bloqueada temporariamente por excesso de tentativas"
        )


def register_failure(db: Session, user: User) -> None:
    """Conta uma tentativa errada (senha ou codigo de 2FA) e bloqueia ao passar do limite.
    Senha e codigo dividem o mesmo contador: quem erra o codigo tambem esta tentando entrar."""
    user.failed_login_attempts += 1
    if user.failed_login_attempts >= settings.max_failed_login_attempts:
        user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=settings.account_lock_minutes)
    db.commit()


def register_success(db: Session, user: User) -> None:
    user.failed_login_attempts = 0
    user.locked_until = None
    db.commit()
