import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_admin
from app.core.errors import AppError, ErrorCode
from app.core.pagination import Page, PageParams, paginate
from app.core.security import generate_invite_token, hash_invite_token
from app.models.user import Invite, User
from app.schemas.user import InviteCreate, InviteCreated, InviteOut

router = APIRouter(prefix="/invites", tags=["invites"])


@router.post("", response_model=InviteCreated, status_code=status.HTTP_201_CREATED)
def create_invite(
    data: InviteCreate,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if db.execute(select(User.id).where(User.email == data.email)).first():
        raise AppError(400, ErrorCode.EMAIL_ALREADY_REGISTERED, "Ja existe um usuario com esse email")

    token = generate_invite_token()
    invite = Invite(
        email=data.email,
        token_hash=hash_invite_token(token),
        created_by=admin.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.invite_expire_days),
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return InviteCreated(**InviteOut.model_validate(invite).model_dump(), token=token)


@router.get("", response_model=Page[InviteOut])
def list_invites(
    params: PageParams = Depends(),
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    # Desempate por id: sem ele, convites criados no mesmo instante trocam de pagina
    statement = select(Invite).order_by(Invite.created_at.desc(), Invite.id)
    return paginate(db, statement, params)


@router.delete("/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invite(
    invite_id: uuid.UUID,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    invite = db.get(Invite, invite_id)
    if not invite:
        raise AppError(404, ErrorCode.INVITE_NOT_FOUND, "Convite nao encontrado")
    db.delete(invite)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
