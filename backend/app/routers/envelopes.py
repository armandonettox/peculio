import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core import clock
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import AppError, ErrorCode
from app.models.user import User
from app.schemas.envelope import AllocationSet, EnvelopeMonthOut, EnvelopeMove, parse_month
from app.services import envelopes as service

router = APIRouter(prefix="/envelopes", tags=["envelopes"])


def _month(text: str | None):
    """O primeiro dia do mes pedido ("AAAA-MM"); sem pedido, o mes de hoje."""
    if text is None:
        return clock.today().replace(day=1)
    try:
        return parse_month(text)
    except ValueError as error:
        raise AppError(422, ErrorCode.VALIDATION_ERROR, str(error)) from error


@router.get("", response_model=EnvelopeMonthOut)
def get_month(
    month: str | None = Query(default=None, description="AAAA-MM; sem ele, o mes de hoje"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Os envelopes do mes e o "A orcar" de cada moeda."""
    return service.month_view(db, user, _month(month))


# Precisa vir antes de /{budget_id}/{month}: senao "move" seria lido como um id
@router.post("/move", response_model=EnvelopeMonthOut, status_code=status.HTTP_200_OK)
def move_money(data: EnvelopeMove, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Passa dinheiro de um envelope para outro no mes. Tira do disponivel do primeiro."""
    month = _month(data.month)
    service.move(db, user, data.from_budget_id, data.to_budget_id, month, data.amount)
    db.commit()
    return service.month_view(db, user, month)


@router.put("/{budget_id}/{month}", response_model=EnvelopeMonthOut)
def set_allocation(
    budget_id: uuid.UUID,
    month: str,
    data: AllocationSet,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Define quanto distribuir para o envelope no mes (zero limpa)."""
    first = _month(month)
    service.set_allocation(db, user, budget_id, first, data.amount)
    db.commit()
    return service.month_view(db, user, first)
