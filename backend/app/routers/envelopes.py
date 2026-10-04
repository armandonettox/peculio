import uuid

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core import clock
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import AppError, ErrorCode
from app.models.user import User
from app.schemas.envelope import AllocationSet, EnvelopeMove, parse_month
from app.schemas.template import (
    EnvelopeMonthFullOut,
    TemplateApply,
    TemplateIn,
    TemplateOut,
    TemplatePreviewOut,
)
from app.services import envelopes as service
from app.services import templates as template_service

router = APIRouter(prefix="/envelopes", tags=["envelopes"])


def _month(text: str | None):
    """O primeiro dia do mes pedido ("AAAA-MM"); sem pedido, o mes de hoje."""
    if text is None:
        return clock.today().replace(day=1)
    try:
        return parse_month(text)
    except ValueError as error:
        raise AppError(422, ErrorCode.VALIDATION_ERROR, str(error)) from error


@router.get("", response_model=EnvelopeMonthFullOut)
def get_month(
    month: str | None = Query(default=None, description="AAAA-MM; sem ele, o mes de hoje"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Os envelopes do mes, o "A orcar" de cada moeda e o template e o selo de meta de cada envelope."""
    return template_service.month_with_templates(db, user, _month(month))


# ---------- Templates ----------
# Precisam vir antes de /{budget_id}/{month}: senao "templates" e "template" seriam lidos como id e mes


@router.get("/templates/preview", response_model=TemplatePreviewOut)
def preview_templates(
    month: str | None = Query(default=None, description="AAAA-MM; sem ele, o mes de hoje"),
    overwrite: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """O que aplicar os templates faria neste mes, sem gravar nada."""
    return template_service.preview(db, user, _month(month), overwrite)


@router.post("/templates/apply", response_model=EnvelopeMonthFullOut)
def apply_templates(data: TemplateApply, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Aplica os templates no mes. Sem `overwrite`, so os envelopes que ainda nao tem valor."""
    month = _month(data.month)
    template_service.apply(db, user, month, data.overwrite)
    db.commit()
    return template_service.month_with_templates(db, user, month)


@router.put("/{budget_id}/template", response_model=TemplateOut)
def set_template(budget_id: uuid.UUID, data: TemplateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Define (ou troca) o template do envelope. Nada e distribuido: so quando mandar aplicar."""
    template = template_service.set_template(db, user, budget_id, data)
    db.commit()
    db.refresh(template)
    return template


@router.delete("/{budget_id}/template", status_code=status.HTTP_204_NO_CONTENT)
def remove_template(budget_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    template_service.remove_template(db, user, budget_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- Distribuir e mover ----------


# Precisa vir antes de /{budget_id}/{month}: senao "move" seria lido como um id
@router.post("/move", response_model=EnvelopeMonthFullOut, status_code=status.HTTP_200_OK)
def move_money(data: EnvelopeMove, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Passa dinheiro de um envelope para outro no mes. Tira do disponivel do primeiro."""
    month = _month(data.month)
    service.move(db, user, data.from_budget_id, data.to_budget_id, month, data.amount)
    db.commit()
    return template_service.month_with_templates(db, user, month)


@router.put("/{budget_id}/{month}", response_model=EnvelopeMonthFullOut)
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
    return template_service.month_with_templates(db, user, first)
