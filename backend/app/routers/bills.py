import uuid
from datetime import date

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core import clock
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.pagination import Page, PageParams
from app.models.user import User
from app.schemas.bill import BillCreate, BillOut, BillStatusOut, BillUpdate
from app.services import bills as service

router = APIRouter(prefix="/bills", tags=["bills"])


def _out(db: Session, bill) -> dict:
    return service.build_outputs(db, [bill])[0]


@router.post("", response_model=BillOut, status_code=status.HTTP_201_CREATED)
def create_bill(data: BillCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    bill = service.create_bill(db, user, data)
    db.commit()
    db.refresh(bill)
    return _out(db, bill)


@router.get("", response_model=Page[BillOut])
def list_bills(
    params: PageParams = Depends(),
    q: str | None = None,
    active: bool | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.list_bills(db, user.id, params, q, active)


# Precisa vir antes de /{bill_id}: senao "status" seria lido como um id
@router.get("/status", response_model=list[BillStatusOut])
def bills_status(
    on: date | None = None,
    include_archived: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Ultimo e proximo vencimento de cada conta a pagar na data `on` (hoje, se omitida), e se o
    ultimo foi pago. Ordenadas pelo proximo vencimento."""
    return service.status(db, user.id, on or clock.today(), include_archived)


@router.get("/{bill_id}", response_model=BillOut)
def get_bill(bill_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _out(db, service.get_owned_bill(db, user.id, bill_id))


@router.patch("/{bill_id}", response_model=BillOut)
def update_bill(
    bill_id: uuid.UUID,
    data: BillUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    bill = service.get_owned_bill(db, user.id, bill_id)
    service.update_bill(db, bill, data)
    db.commit()
    db.refresh(bill)
    return _out(db, bill)


@router.delete("/{bill_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bill(bill_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    bill = service.get_owned_bill(db, user.id, bill_id)
    service.delete_bill(db, bill)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
