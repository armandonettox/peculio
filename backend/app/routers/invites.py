import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_admin
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
        raise HTTPException(status_code=400, detail="Ja existe um usuario com esse email")

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


@router.get("", response_model=list[InviteOut])
def list_invites(
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    return db.execute(select(Invite).order_by(Invite.created_at.desc())).scalars().all()


@router.delete("/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invite(
    invite_id: uuid.UUID,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    invite = db.get(Invite, invite_id)
    if not invite:
        raise HTTPException(status_code=404, detail="Convite nao encontrado")
    db.delete(invite)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
