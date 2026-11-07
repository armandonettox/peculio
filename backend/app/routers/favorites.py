import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.favorite import FavoriteIn, FavoriteOut, FavoriteType, SuggestionOut
from app.services import favorites as service

router = APIRouter(prefix="/favorites", tags=["favorites"])


@router.post("", response_model=FavoriteOut)
def save_favorite(
    data: FavoriteIn, response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Marca a descricao como favorita (201) ou atualiza a categoria e a conta de um favorito que ja existe (200)."""
    favorite, created = service.save_favorite(db, user.id, data)
    db.commit()
    db.refresh(favorite)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return favorite


@router.get("", response_model=list[FavoriteOut])
def list_favorites(
    type: FavoriteType | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return service.list_favorites(db, user.id, type)


@router.get("/suggestions", response_model=list[SuggestionOut])
def suggestions(
    type: FavoriteType,
    q: Annotated[str, Query(max_length=255)] = "",
    limit: Annotated[int, Query(ge=1, le=20)] = 8,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Sugestoes para a descricao de um lancamento novo: favoritos primeiro, depois o que ja foi lancado."""
    return service.suggestions(db, user.id, type, q, limit)


@router.delete("/{favorite_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_favorite(favorite_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    favorite = service.get_owned_favorite(db, user.id, favorite_id)
    db.delete(favorite)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
