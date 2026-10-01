import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.pagination import Page, PageParams
from app.models.user import User
from app.schemas.transaction import CounterpartyOut, TransactionCreate, TransactionOut, TransactionUpdate
from app.services import transactions as service

router = APIRouter(prefix="/transactions", tags=["transactions"])

# Valor de filtro: ate 2 casas, como o dinheiro em toda a API
AmountFilter = Annotated[Decimal | None, Query(max_digits=18, decimal_places=2)]


@router.post("", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def create_transaction(data: TransactionCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    transaction = service.create_transaction(db, user, data)
    db.commit()
    return service.build_output(db, transaction)


@router.get("", response_model=Page[TransactionOut])
def list_transactions(
    params: PageParams = Depends(),
    account_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    budget_id: uuid.UUID | None = None,
    tag_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    min_amount: AmountFilter = None,
    max_amount: AmountFilter = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.list_transactions(
        db,
        user.id,
        params,
        account_id=account_id,
        category_id=category_id,
        budget_id=budget_id,
        tag_id=tag_id,
        date_from=date_from,
        date_to=date_to,
        q=q,
        min_amount=min_amount,
        max_amount=max_amount,
    )


# Precisa vir antes de /{transaction_id}: senao "counterparties" seria lido como um id
@router.get("/counterparties", response_model=list[CounterpartyOut])
def list_counterparties(
    type: Literal["expense", "revenue"],
    q: str | None = None,
    limit: int = Query(20, ge=1, le=50),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.list_counterparties(db, user.id, type, q, limit)


@router.get("/{transaction_id}", response_model=TransactionOut)
def get_transaction(transaction_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    transaction = service.get_owned_transaction(db, user.id, transaction_id)
    return service.build_output(db, transaction)


@router.put("/{transaction_id}", response_model=TransactionOut)
def update_transaction(
    transaction_id: uuid.UUID,
    data: TransactionUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    transaction = service.get_owned_transaction(db, user.id, transaction_id)
    service.replace_transaction(db, user, transaction, data)
    db.commit()
    return service.build_output(db, transaction)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(transaction_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    transaction = service.get_owned_transaction(db, user.id, transaction_id)
    service.delete_transaction(db, transaction)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
