import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.pagination import Page, PageParams
from app.models.account import USER_ACCOUNT_TYPES, Account
from app.models.user import User
from app.schemas.account import AccountCreate, AccountOut, AccountUpdate
from app.services import accounts as service

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.post("", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(data: AccountCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    account = service.create_account(db, user, data)
    db.commit()
    db.refresh(account)
    return service.build_outputs(db, [account])[0]


@router.get("", response_model=Page[AccountOut])
def list_accounts(
    params: PageParams = Depends(),
    type: Literal["asset", "liability"] | None = None,
    active: bool | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # So contas do usuario: as de sistema (saldo inicial) nunca aparecem
    statement = select(Account).where(Account.user_id == user.id, Account.type.in_(USER_ACCOUNT_TYPES))
    if type is not None:
        statement = statement.where(Account.type == type)
    if active is not None:
        statement = statement.where(Account.active == active)
    # Desempate por id: sem ele, contas com o mesmo nome trocam de pagina
    statement = statement.order_by(func.lower(Account.name), Account.id)

    total = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    page = db.execute(statement.limit(params.limit).offset(params.offset)).scalars().all()
    return {
        "items": service.build_outputs(db, list(page)),
        "total": total,
        "limit": params.limit,
        "offset": params.offset,
    }


@router.get("/{account_id}", response_model=AccountOut)
def get_account(account_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    account = service.get_owned_account(db, user.id, account_id)
    return service.build_outputs(db, [account])[0]


@router.patch("/{account_id}", response_model=AccountOut)
def update_account(
    account_id: uuid.UUID,
    data: AccountUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    account = service.get_owned_account(db, user.id, account_id)
    service.update_account(db, account, data)
    db.commit()
    db.refresh(account)
    return service.build_outputs(db, [account])[0]


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    account = service.get_owned_account(db, user.id, account_id)
    service.delete_account(db, account)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
