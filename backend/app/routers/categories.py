import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import ErrorCode
from app.core.pagination import Page, PageParams
from app.models.category import Category
from app.models.user import User
from app.schemas.labels import CategoryCreate, CategoryOut, CategoryUpdate
from app.services import named

router = APIRouter(prefix="/categories", tags=["categories"])

SPEC = named.NamedResource(
    model=Category,
    not_found_code=ErrorCode.CATEGORY_NOT_FOUND,
    not_found_message="Categoria nao encontrada",
    taken_code=ErrorCode.CATEGORY_NAME_TAKEN,
    taken_message="Ja existe uma categoria com esse nome",
)


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(data: CategoryCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    category = named.create(db, SPEC, user.id, name=data.name, color=data.color)
    db.commit()
    db.refresh(category)
    return category


@router.get("", response_model=Page[CategoryOut])
def list_categories(
    params: PageParams = Depends(),
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return named.list_page(db, SPEC, user.id, params, q)


@router.get("/{category_id}", response_model=CategoryOut)
def get_category(category_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return named.get_owned(db, SPEC, user.id, category_id)


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: uuid.UUID,
    data: CategoryUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    category = named.get_owned(db, SPEC, user.id, category_id)
    # So o que veio no corpo: assim "color": null limpa a cor, e omitir o campo nao mexe nela
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is None:
        changes.pop("name")
    named.update(db, SPEC, category, changes)
    db.commit()
    db.refresh(category)
    return category


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    category = named.get_owned(db, SPEC, user.id, category_id)
    named.delete(db, category)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
