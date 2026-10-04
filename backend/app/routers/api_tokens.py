import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_session_user
from app.core.pagination import Page, PageParams
from app.models.user import User
from app.schemas.api_token import ApiTokenCreate, ApiTokenCreated, ApiTokenOut
from app.services import api_tokens as service

# Tudo aqui exige o login da tela: um token de API nunca cria, lista nem revoga tokens
router = APIRouter(prefix="/api-tokens", tags=["api-tokens"])


@router.post("", response_model=ApiTokenCreated, status_code=status.HTTP_201_CREATED)
def create_api_token(data: ApiTokenCreate, user: User = Depends(get_session_user), db: Session = Depends(get_db)):
    """Cria um token. O valor completo (`token`) aparece so nesta resposta: depois so o prefixo."""
    token, value = service.create_token(db, user, data)
    db.commit()
    return {**service.to_output(token), "token": value}


@router.get("", response_model=Page[ApiTokenOut])
def list_api_tokens(
    params: PageParams = Depends(), user: User = Depends(get_session_user), db: Session = Depends(get_db)
):
    return service.list_tokens(db, user.id, params)


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_api_token(token_id: uuid.UUID, user: User = Depends(get_session_user), db: Session = Depends(get_db)):
    token = service.get_owned_token(db, user.id, token_id)
    service.rate_limiter.forget(token.id)
    service.revoke_token(db, token)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
