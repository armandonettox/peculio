from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core import two_factor
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import AppError, ErrorCode
from app.core.rate_limit import limiter
from app.core.security import (
    create_access_token,
    decode_challenge_token,
    parse_user_id,
    password_fingerprint,
    verify_password_constant_time,
)
from app.models.user import RecoveryCode, User
from app.schemas.user import (
    RecoveryCodesOut,
    Token,
    TwoFactorCode,
    TwoFactorConfirm,
    TwoFactorSetupOut,
    TwoFactorStatus,
    TwoFactorVerify,
)
from app.services.login_attempts import ensure_not_locked, register_failure, register_success

router = APIRouter(prefix="/auth/2fa", tags=["2fa"])


def _invalid_code() -> AppError:
    return AppError(401, ErrorCode.TWO_FACTOR_INVALID_CODE, "Codigo invalido")


def _consume_code(db: Session, user: User, code: str) -> bool:
    """Confere um codigo TOTP ou de recuperacao e, se vale, marca como usado (sem commit: quem
    chama decide quando gravar). Um codigo de recuperacao so funciona uma vez."""
    if two_factor.looks_like_totp(code):
        secret = two_factor.decrypt_secret(user.totp_secret_encrypted) if user.totp_secret_encrypted else None
        if secret is None:
            return False
        step = two_factor.verify_totp(secret, two_factor.normalize_code(code), user.totp_last_step)
        if step is None:
            return False
        user.totp_last_step = step
        return True

    recovery = db.execute(
        select(RecoveryCode)
        .where(
            RecoveryCode.user_id == user.id,
            RecoveryCode.code_hash == two_factor.hash_recovery_code(code),
            RecoveryCode.used_at.is_(None),
        )
        .with_for_update()
    ).scalar_one_or_none()
    if recovery is None:
        return False
    recovery.used_at = datetime.now(timezone.utc)
    return True


def _replace_recovery_codes(db: Session, user: User) -> list[str]:
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    codes = two_factor.generate_recovery_codes()
    db.add_all(RecoveryCode(user_id=user.id, code_hash=two_factor.hash_recovery_code(c)) for c in codes)
    return codes


def _require_password_and_code(db: Session, user: User, data: TwoFactorConfirm) -> None:
    """Desligar o 2FA ou gerar novos codigos pede senha e codigo: um token de sessao roubado
    sozinho nao basta. Erro conta como tentativa de login."""
    if not user.totp_enabled:
        raise AppError(409, ErrorCode.TWO_FACTOR_NOT_ENABLED, "O 2FA nao esta ativado")
    if not verify_password_constant_time(data.password, user.hashed_password):
        register_failure(db, user)
        raise AppError(403, ErrorCode.INVALID_PASSWORD, "Senha incorreta")
    if not _consume_code(db, user, data.code):
        db.rollback()
        register_failure(db, user)
        raise _invalid_code()


@router.post("/verify", response_model=Token)
@limiter.limit("10/minute")
def verify_login(request: Request, data: TwoFactorVerify, db: Session = Depends(get_db)):
    """Passo 2 do login: troca o desafio e um codigo pelo token de acesso."""
    invalid = AppError(401, ErrorCode.TWO_FACTOR_CHALLENGE_INVALID, "Desafio invalido ou expirado, entre novamente")
    try:
        claims = decode_challenge_token(data.challenge_token)
        user_id = parse_user_id(claims["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise invalid

    # Trava a linha: dois pedidos simultaneos com o mesmo codigo nao passam juntos
    user = db.execute(select(User).where(User.id == user_id).with_for_update()).scalar_one_or_none()
    if (
        user is None
        or not user.totp_enabled
        or claims.get("pv") != password_fingerprint(user.hashed_password)
    ):
        raise invalid
    ensure_not_locked(user)

    if not _consume_code(db, user, data.code):
        db.rollback()
        register_failure(db, user)
        raise _invalid_code()

    register_success(db, user)
    return Token(access_token=create_access_token(subject=str(user.id), password_hash=user.hashed_password))


@router.get("/status", response_model=TwoFactorStatus)
def two_factor_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    remaining = db.execute(
        select(func.count()).select_from(RecoveryCode).where(
            RecoveryCode.user_id == user.id, RecoveryCode.used_at.is_(None)
        )
    ).scalar_one()
    return TwoFactorStatus(enabled=user.totp_enabled, recovery_codes_remaining=remaining)


@router.post("/setup", response_model=TwoFactorSetupOut)
@limiter.limit("10/minute")
def setup(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Gera um segredo novo, ainda inativo. Chamar de novo antes de ativar troca o segredo."""
    if user.totp_enabled:
        raise AppError(409, ErrorCode.TWO_FACTOR_ALREADY_ENABLED, "O 2FA ja esta ativado")
    secret = two_factor.generate_totp_secret()
    user.totp_secret_encrypted = two_factor.encrypt_secret(secret)
    user.totp_last_step = None
    db.commit()
    return TwoFactorSetupOut(secret=secret, otpauth_url=two_factor.provisioning_uri(secret, user.email))


@router.post("/enable", response_model=RecoveryCodesOut)
@limiter.limit("10/minute")
def enable(request: Request, data: TwoFactorCode, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Confirma o segredo com um codigo do app e ativa. Devolve os codigos de recuperacao."""
    if user.totp_enabled:
        raise AppError(409, ErrorCode.TWO_FACTOR_ALREADY_ENABLED, "O 2FA ja esta ativado")
    secret = two_factor.decrypt_secret(user.totp_secret_encrypted) if user.totp_secret_encrypted else None
    if secret is None:
        raise AppError(400, ErrorCode.TWO_FACTOR_SETUP_REQUIRED, "Gere o segredo antes de ativar")
    # Na ativacao so vale o codigo do app: codigo de recuperacao ainda nem existe
    step = (
        two_factor.verify_totp(secret, two_factor.normalize_code(data.code), None)
        if two_factor.looks_like_totp(data.code)
        else None
    )
    if step is None:
        raise _invalid_code()

    user.totp_enabled = True
    user.totp_last_step = step
    codes = _replace_recovery_codes(db, user)
    db.commit()
    return RecoveryCodesOut(recovery_codes=codes)


@router.post("/disable", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
def disable(request: Request, data: TwoFactorConfirm, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_password_and_code(db, user, data)
    user.totp_enabled = False
    user.totp_secret_encrypted = None
    user.totp_last_step = None
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/recovery-codes", response_model=RecoveryCodesOut)
@limiter.limit("5/minute")
def regenerate_recovery_codes(
    request: Request,
    data: TwoFactorConfirm,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Troca todos os codigos de recuperacao por 10 novos; os antigos deixam de valer."""
    _require_password_and_code(db, user, data)
    codes = _replace_recovery_codes(db, user)
    db.commit()
    return RecoveryCodesOut(recovery_codes=codes)
