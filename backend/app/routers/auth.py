from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user, oauth2_scheme
from app.core.errors import AppError, ErrorCode
from app.core.rate_limit import limiter
from app.core.security import (
    create_access_token,
    create_challenge_token,
    decode_access_token,
    hash_invite_token,
    hash_password,
    password_fingerprint,
    verify_password_constant_time,
)
from app.models.user import Invite, User
from app.schemas.user import AuthStatus, LoginOut, Token, UserCreate, UserLogin, UserOut
from app.services.login_attempts import ensure_not_locked, register_failure, register_success

router = APIRouter(prefix="/auth", tags=["auth"])

# Chave da trava de registro no PostgreSQL (qualquer inteiro fixo, so precisa ser unico no app)
REGISTRATION_LOCK_KEY = 7421001


def _consume_invite(db: Session, data: UserCreate) -> None:
    """Valida o convite e marca como usado na mesma transacao que cria o usuario."""
    invalid = AppError(403, ErrorCode.INVITE_INVALID, "Convite invalido ou expirado")
    if not data.invite_token:
        raise AppError(403, ErrorCode.INVITE_REQUIRED, "Cadastro disponivel somente por convite")

    # with_for_update trava a linha: dois registros com o mesmo convite nao passam juntos
    invite = db.execute(
        select(Invite)
        .where(Invite.token_hash == hash_invite_token(data.invite_token))
        .with_for_update()
    ).scalar_one_or_none()
    if not invite or invite.used_at or invite.expires_at < datetime.now(timezone.utc):
        raise invalid
    if invite.email != data.email:
        raise invalid
    invite.used_at = datetime.now(timezone.utc)


@router.get("/status", response_model=AuthStatus)
def auth_status(db: Session = Depends(get_db)):
    """Publico. Diz se a instancia ainda nao tem nenhum usuario, para o frontend saber se
    mostra "criar conta de administrador" ou "entrar / usar convite"."""
    return AuthStatus(setup_required=db.execute(select(User.id).limit(1)).first() is None)


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def register(request: Request, data: UserCreate, db: Session = Depends(get_db)):
    # Trava ate o fim da transacao. Sem ela, dois registros simultaneos podem ler "0 usuarios"
    # antes de qualquer commit e os dois virarem admin. A trava de banco vale mesmo com
    # varios workers, diferente de um Lock do Python.
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": REGISTRATION_LOCK_KEY})

    is_first_user = db.execute(select(User.id).limit(1)).first() is None
    if not is_first_user:
        _consume_invite(db, data)

    if db.execute(select(User.id).where(User.email == data.email)).first():
        db.rollback()
        raise AppError(400, ErrorCode.EMAIL_ALREADY_REGISTERED, "Email ja cadastrado")

    user = User(
        name=data.name,
        email=data.email,
        hashed_password=hash_password(data.password),
        is_admin=is_first_user,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AppError(400, ErrorCode.EMAIL_ALREADY_REGISTERED, "Email ja cadastrado")
    db.refresh(user)
    return user


@router.post("/login", response_model=LoginOut)
@limiter.limit("10/minute")
def login(request: Request, data: UserLogin, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.email == data.email)).scalar_one_or_none()

    ensure_not_locked(user)

    # Roda o bcrypt mesmo quando o usuario nao existe, para nao revelar pelo tempo de resposta
    # quais emails estao cadastrados.
    password_ok = verify_password_constant_time(
        data.password, user.hashed_password if user else None
    )
    if not user or not password_ok:
        if user:
            register_failure(db, user)
        raise AppError(401, ErrorCode.INVALID_CREDENTIALS, "Email ou senha invalidos")

    # Com 2FA ligado a senha certa ainda nao basta: entrega so o desafio, que o passo 2 troca
    # pelo token de acesso. As tentativas so zeram quando o segundo passo tambem passa.
    if user.totp_enabled:
        return LoginOut(
            two_factor_required=True,
            challenge_token=create_challenge_token(str(user.id), user.hashed_password),
        )

    register_success(db, user)
    token = create_access_token(subject=str(user.id), password_hash=user.hashed_password)
    return LoginOut(access_token=token)


@router.post("/refresh", response_model=Token)
@limiter.limit("30/minute")
def refresh_session(
    request: Request,
    token: str = Depends(oauth2_scheme),
    current_user: User = Depends(get_current_user),
):
    """Sessao deslizante: troca um token ainda valido por um novo, sem novo login. Usuario
    apagado e conta bloqueada ja sao barrados no get_current_user. Aqui ficam o teto
    absoluto da sessao e a troca de senha."""
    claims = decode_access_token(token)

    now = datetime.now(timezone.utc)
    auth_at = datetime.fromtimestamp(claims["auth_at"], tz=timezone.utc) if "auth_at" in claims else now

    if settings.session_max_hours > 0 and now - auth_at > timedelta(hours=settings.session_max_hours):
        raise AppError(401, ErrorCode.SESSION_EXPIRED, "Sessao expirada, entre novamente")

    if "pv" in claims and claims["pv"] != password_fingerprint(current_user.hashed_password):
        raise AppError(401, ErrorCode.SESSION_INVALID, "Sessao invalida, entre novamente")

    new_token = create_access_token(
        subject=str(current_user.id), auth_at=auth_at, password_hash=current_user.hashed_password
    )
    return Token(access_token=new_token)


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
