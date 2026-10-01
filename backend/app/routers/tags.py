import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import ErrorCode
from app.core.pagination import Page, PageParams
from app.models.tag import Tag
from app.models.user import User
from app.schemas.labels import TagCreate, TagOut, TagUpdate
from app.services import named

router = APIRouter(prefix="/tags", tags=["tags"])

SPEC = named.NamedResource(
    model=Tag,
    not_found_code=ErrorCode.TAG_NOT_FOUND,
    not_found_message="Tag nao encontrada",
    taken_code=ErrorCode.TAG_NAME_TAKEN,
    taken_message="Ja existe uma tag com esse nome",
)


@router.post("", response_model=TagOut, status_code=status.HTTP_201_CREATED)
def create_tag(data: TagCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tag = named.create(db, SPEC, user.id, name=data.name)
    db.commit()
    db.refresh(tag)
    return tag


@router.get("", response_model=Page[TagOut])
def list_tags(
    params: PageParams = Depends(),
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return named.list_page(db, SPEC, user.id, params, q)


@router.get("/{tag_id}", response_model=TagOut)
def get_tag(tag_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return named.get_owned(db, SPEC, user.id, tag_id)


@router.patch("/{tag_id}", response_model=TagOut)
def update_tag(
    tag_id: uuid.UUID,
    data: TagUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tag = named.get_owned(db, SPEC, user.id, tag_id)
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is None:
        changes.pop("name")
    named.update(db, SPEC, tag, changes)
    db.commit()
    db.refresh(tag)
    return tag


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(tag_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tag = named.get_owned(db, SPEC, user.id, tag_id)
    named.delete(db, tag)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
