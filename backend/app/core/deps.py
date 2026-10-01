from datetime import datetime, timezone

import jwt
from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError, ErrorCode
from app.core.security import decode_access_token, parse_user_id
from app.models.user import User

# auto_error desligado para a falta do token cair no nosso formato de erro, nao no padrao
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

_BEARER_HEADERS = {"WWW-Authenticate": "Bearer"}


def get_current_user(token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    if not token:
        raise AppError(401, ErrorCode.TOKEN_MISSING, "Token ausente", _BEARER_HEADERS)
    try:
        payload = decode_access_token(token)
        user_id = parse_user_id(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise AppError(401, ErrorCode.TOKEN_INVALID, "Token invalido", _BEARER_HEADERS)

    user = db.get(User, user_id)
    if not user:
        raise AppError(401, ErrorCode.USER_NOT_FOUND, "Usuario nao encontrado", _BEARER_HEADERS)
    if user.locked_until and user.locked_until > datetime.now(timezone.utc):
        raise AppError(401, ErrorCode.ACCOUNT_LOCKED, "Conta bloqueada", _BEARER_HEADERS)
    return user


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise AppError(403, ErrorCode.ADMIN_REQUIRED, "Apenas administradores")
    return user
