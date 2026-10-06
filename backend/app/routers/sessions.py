import uuid

import jwt
from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_session_user, oauth2_scheme
from app.core.errors import AppError, ErrorCode
from app.core.rate_limit import limiter
from app.core.security import create_access_token, decode_access_token
from app.models.auth_session import AuthSession
from app.models.user import User
from app.schemas.session import SessionOut, SessionsRevoked
from app.schemas.user import Token
from app.services import auth_sessions
from app.services.auth_sessions import CLIENT_HEADER, CLIENT_HEADER_VALUE, REFRESH_COOKIE
from app.services.login_attempts import ensure_not_locked

router = APIRouter(prefix="/auth", tags=["auth"])


def _require_client_header(request: Request) -> None:
    """Restaurar e sair so valem com o cabecalho do app. Pedido forjado de outro site nao o consegue mandar."""
    if request.headers.get(CLIENT_HEADER) != CLIENT_HEADER_VALUE:
        raise AppError(403, ErrorCode.CLIENT_HEADER_MISSING, "Pedido sem o cabecalho do aplicativo")


def _current_session_id(token: str | None) -> uuid.UUID | None:
    if not token:
        return None
    try:
        return auth_sessions.parse_session_id(decode_access_token(token).get("sid"))
    except jwt.PyJWTError:
        return None


@router.post("/session", response_model=Token)
@limiter.limit("30/minute")
def restore_session(request: Request, response: Response, db: Session = Depends(get_db)):
    """Ao abrir o app (ou recarregar a pagina): troca o cookie de renovacao por um token de acesso novo, sem pedir senha.
    A chave do cookie e trocada a cada uso."""
    _require_client_header(request)
    raw = request.cookies.get(REFRESH_COOKIE)

    def invalid() -> JSONResponse:
        failure = JSONResponse(
            status_code=401, content={"detail": "Sessao invalida, entre novamente", "code": ErrorCode.SESSION_INVALID}
        )
        auth_sessions.clear_refresh_cookie(failure)
        return failure

    if not raw:
        return invalid()
    try:
        session, fresh = auth_sessions.rotate(db, raw)
    except auth_sessions.InvalidRefresh:
        return invalid()

    user = db.get(User, session.user_id)
    if user is None:
        return invalid()
    ensure_not_locked(user)

    if fresh is not None:
        auth_sessions.set_refresh_cookie(response, fresh, session.remember)
    return Token(
        access_token=create_access_token(
            subject=str(user.id), password_hash=user.hashed_password, session_id=str(session.id)
        )
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """Sair de verdade: encerra a sessao no servidor (o cookie e o token deixam de valer) e apaga o cookie."""
    _require_client_header(request)
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        auth_sessions.revoke_by_cookie(db, raw)
    session_id = _current_session_id(token)
    if session_id is not None:
        session = db.get(AuthSession, session_id)
        if session is not None:
            auth_sessions.revoke(db, session)
    done = Response(status_code=status.HTTP_204_NO_CONTENT)
    auth_sessions.clear_refresh_cookie(done)
    return done


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(
    token: str = Depends(oauth2_scheme),
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
):
    """Os aparelhos conectados desta conta."""
    current = _current_session_id(token)
    return [
        SessionOut.model_validate(item).model_copy(update={"current": item.id == current})
        for item in auth_sessions.list_active(db, user.id)
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(session_id: uuid.UUID, user: User = Depends(get_session_user), db: Session = Depends(get_db)):
    """Encerra um aparelho. 404 tambem quando a sessao e de outra pessoa, para nao revelar que ela existe."""
    session = auth_sessions.get_active(db, session_id, user.id)
    if session is None:
        raise AppError(404, ErrorCode.SESSION_NOT_FOUND, "Sessao nao encontrada")
    auth_sessions.revoke(db, session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/sessions", response_model=SessionsRevoked)
def revoke_other_sessions(
    token: str = Depends(oauth2_scheme),
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
):
    """Encerra todos os aparelhos, menos este."""
    return SessionsRevoked(revoked=auth_sessions.revoke_all_except(db, user.id, _current_session_id(token)))

