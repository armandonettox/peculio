from datetime import datetime, timezone

import jwt
from fastapi import Depends, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core import clock
from app.core.database import SessionLocal, get_db
from app.core.errors import AppError, ErrorCode
from app.core.security import decode_access_token, parse_user_id, password_fingerprint
from app.models.api_token import ApiToken
from app.models.user import User
from app.services import api_tokens, auth_sessions

# auto_error desligado para a falta do token cair no nosso formato de erro, nao no padrao
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

_BEARER_HEADERS = {"WWW-Authenticate": "Bearer"}


def _check_not_locked(user: User) -> None:
    if user.locked_until and user.locked_until > datetime.now(timezone.utc):
        raise AppError(401, ErrorCode.ACCOUNT_LOCKED, "Conta bloqueada", _BEARER_HEADERS)


def _touch_last_used(token_id) -> None:
    """Grava o ultimo uso numa sessao propria: a requisicao pode falhar e voltar atras sem desfazer isto."""
    with SessionLocal() as session:
        session.execute(update(ApiToken).where(ApiToken.id == token_id).values(last_used_at=clock.utc_now()))
        session.commit()


def _user_from_api_token(request: Request, raw: str, db: Session) -> User:
    token = api_tokens.authenticate(db, raw)
    if not api_tokens.within_rate_limit(token):
        raise AppError(
            429, ErrorCode.RATE_LIMITED, "Muitas requisicoes com este token. Tente novamente em instantes", {"Retry-After": "60"}
        )
    user = db.get(User, token.user_id)
    if not user:
        raise AppError(401, ErrorCode.USER_NOT_FOUND, "Usuario nao encontrado", _BEARER_HEADERS)
    _check_not_locked(user)
    if not api_tokens.allows_method(token, request.method):
        raise AppError(
            403,
            ErrorCode.API_TOKEN_READ_ONLY,
            "Este token e so de leitura: ele consulta, mas nao cria, edita nem exclui",
        )
    if api_tokens.needs_last_used_update(token):
        _touch_last_used(token.id)
    return user


def get_current_user(
    request: Request, token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    """O dono do token da requisicao. Vale o login da tela (JWT) e o token de API (`fin_...`)."""
    if not token:
        raise AppError(401, ErrorCode.TOKEN_MISSING, "Token ausente", _BEARER_HEADERS)
    if token.startswith(api_tokens.TOKEN_PREFIX):
        return _user_from_api_token(request, token, db)
    try:
        payload = decode_access_token(token)
        user_id = parse_user_id(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise AppError(401, ErrorCode.TOKEN_INVALID, "Token invalido", _BEARER_HEADERS)

    user = db.get(User, user_id)
    if not user:
        raise AppError(401, ErrorCode.USER_NOT_FOUND, "Usuario nao encontrado", _BEARER_HEADERS)
    # Senha trocada: o token emitido com a senha antiga deixa de valer na hora, nao so na renovacao.
    # Token legado, de antes da impressao da senha, nao traz "pv" e segue valendo (como na renovacao)
    if "pv" in payload and payload["pv"] != password_fingerprint(user.hashed_password):
        raise AppError(401, ErrorCode.SESSION_INVALID, "Sessao invalida, entre novamente", _BEARER_HEADERS)
    # Token ligado a uma sessao: encerrar o aparelho derruba o token na hora. Token antigo, sem `sid`, segue valendo
    # ate expirar.
    if "sid" in payload:
        session_id = auth_sessions.parse_session_id(payload["sid"])
        if session_id is None or auth_sessions.get_active(db, session_id, user.id) is None:
            raise AppError(401, ErrorCode.SESSION_INVALID, "Sessao encerrada, entre novamente", _BEARER_HEADERS)
    _check_not_locked(user)
    return user


def get_session_user(
    request: Request, token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    """Como `get_current_user`, mas so vale o login da tela. Serve para o que um token de API vazado nunca
    pode fazer: criar outros tokens, mexer em 2FA, renovar a sessao ou criar convites."""
    if token and token.startswith(api_tokens.TOKEN_PREFIX):
        raise AppError(
            403,
            ErrorCode.SESSION_REQUIRED,
            "Esta acao exige entrar pela tela: nao vale com token de API",
        )
    return get_current_user(request, token, db)


def get_current_admin(user: User = Depends(get_session_user)) -> User:
    if not user.is_admin:
        raise AppError(403, ErrorCode.ADMIN_REQUIRED, "Apenas administradores")
    return user
