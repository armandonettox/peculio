import uuid
from datetime import date

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.pagination import Page, PageParams
from app.models.user import User
from app.schemas.budget import BudgetCreate, BudgetOut, BudgetProgressOut, BudgetUpdate
from app.services import budgets as service

router = APIRouter(prefix="/budgets", tags=["budgets"])


def _out(db: Session, budget) -> dict:
    return service.build_outputs(db, [budget])[0]


@router.post("", response_model=BudgetOut, status_code=status.HTTP_201_CREATED)
def create_budget(data: BudgetCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    budget = service.create_budget(db, user, data)
    db.commit()
    db.refresh(budget)
    return _out(db, budget)


@router.get("", response_model=Page[BudgetOut])
def list_budgets(
    params: PageParams = Depends(),
    q: str | None = None,
    active: bool | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.list_budgets(db, user.id, params, q, active)


# Precisa vir antes de /{budget_id}: senao "progress" seria lido como um id
@router.get("/progress", response_model=list[BudgetProgressOut])
def budgets_progress(
    on: date | None = None,
    include_archived: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Gasto de cada orcamento no periodo que contem a data `on` (hoje, se omitida)."""
    return service.progress(db, user.id, on or date.today(), include_archived)


@router.get("/{budget_id}", response_model=BudgetOut)
def get_budget(budget_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _out(db, service.get_owned_budget(db, user.id, budget_id))


@router.patch("/{budget_id}", response_model=BudgetOut)
def update_budget(
    budget_id: uuid.UUID,
    data: BudgetUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    budget = service.get_owned_budget(db, user.id, budget_id)
    service.update_budget(db, budget, data)
    db.commit()
    db.refresh(budget)
    return _out(db, budget)


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_budget(budget_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    budget = service.get_owned_budget(db, user.id, budget_id)
    service.delete_budget(db, budget)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
