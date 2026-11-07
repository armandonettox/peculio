import uuid

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.monthly_plan import MonthlyPlanCreate, MonthlyPlanOut, MonthlyPlanUpdate, PlanItemsIn
from app.services import monthly_plan as service

router = APIRouter(prefix="/plans/monthly", tags=["monthly-plan"])


def _out(db: Session, user: User, month: str) -> dict:
    return service.build_output(db, user.id, service.require_plan(db, user.id, service.parse_month(month)))


@router.post("/{month}", response_model=MonthlyPlanOut, status_code=status.HTTP_201_CREATED)
def create_plan(month: str, data: MonthlyPlanCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Cria o planejamento do mes (AAAA-MM): renda, quanto economizar, como contar o cartao e os limites por categoria."""
    service.create_plan(db, user, service.parse_month(month), data)
    db.commit()
    return _out(db, user, month)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_plans(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Apaga todos os planejamentos mensais (os lancamentos e as categorias nao mudam)."""
    service.delete_all_plans(db, user.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{month}", response_model=MonthlyPlanOut)
def get_plan(month: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """O planejamento do mes com o gasto de cada categoria (pago e previsto). 404 se o mes ainda nao tem planejamento."""
    return _out(db, user, month)


@router.patch("/{month}", response_model=MonthlyPlanOut)
def update_plan(
    month: str, data: MonthlyPlanUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    plan = service.require_plan(db, user.id, service.parse_month(month))
    service.update_plan(db, plan, data)
    db.commit()
    return _out(db, user, month)


@router.delete("/{month}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(month: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    service.delete_plan(db, service.require_plan(db, user.id, service.parse_month(month)))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{month}/copy-previous", response_model=MonthlyPlanOut, status_code=status.HTTP_201_CREATED)
def copy_previous(month: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Cria o planejamento deste mes como copia do mes anterior."""
    service.copy_previous(db, user, service.parse_month(month))
    db.commit()
    return _out(db, user, month)


@router.put("/{month}/items", response_model=MonthlyPlanOut)
def put_items(month: str, data: PlanItemsIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Grava limites por categoria: cria os novos e troca o valor e o alerta dos que ja existem."""
    plan = service.require_plan(db, user.id, service.parse_month(month))
    service.upsert_items(db, user, plan, data.items)
    db.commit()
    return _out(db, user, month)


@router.delete("/{month}/items/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(month: str, category_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plan = service.require_plan(db, user.id, service.parse_month(month))
    service.delete_item(db, plan, category_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
