import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_admin, get_current_user
from app.core.errors import AppError, ErrorCode
from app.models.user import User

router = APIRouter(prefix="/users", tags=["users"])


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: uuid.UUID,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if user_id == admin.id:
        raise AppError(400, ErrorCode.FORBIDDEN, "Administrador nao pode excluir a propria conta")
    user = db.get(User, user_id)
    if not user:
        raise AppError(404, ErrorCode.USER_NOT_FOUND, "Usuario nao encontrado")
    db.delete(user)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
