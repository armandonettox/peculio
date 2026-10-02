import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.exceptions import RequestValidationError
from sqlalchemy.orm import Session

from app.core import clock
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.report import GroupedReportOut, MonthlyReportOut, SummaryOut
from app.services import reports as service

router = APIRouter(prefix="/reports", tags=["reports"])


def _invalid(field: str, message: str) -> RequestValidationError:
    # Mesmo formato dos outros 422: o frontend mostra a mensagem no campo certo
    return RequestValidationError([{"loc": ("query", field), "msg": message, "type": "value_error"}])


def report_filters(
    period: Literal["this-month", "last-month", "this-year"] | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    account_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    tag_id: uuid.UUID | None = None,
    budget_id: uuid.UUID | None = None,
) -> service.ReportFilters:
    """Filtros iguais em todos os relatorios. Sem datas, vale o mes atual. `period` escolhe um periodo
    pronto pelo relogio do app e nao se mistura com datas."""
    if period is not None:
        if date_from is not None or date_to is not None:
            raise _invalid("period", "Use o periodo pronto ou as datas, nao os dois")
        period_from, period_to = service.preset_period(period, clock.today())
    else:
        period_from, period_to = service.resolve_period(date_from, date_to)
    if period_from > period_to:
        raise _invalid("date_from", "A data inicial nao pode ser depois da data final")
    return service.ReportFilters(
        date_from=period_from,
        date_to=period_to,
        account_id=account_id,
        category_id=category_id,
        tag_id=tag_id,
        budget_id=budget_id,
    )


@router.get("/summary", response_model=SummaryOut)
def get_summary(
    filters: service.ReportFilters = Depends(report_filters),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.summary(db, user.id, filters)


@router.get("/monthly", response_model=MonthlyReportOut)
def get_monthly(
    filters: service.ReportFilters = Depends(report_filters),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if len(service.months_between(filters.date_from, filters.date_to)) > service.MAX_MONTHS:
        raise _invalid("date_from", f"O periodo do grafico mensal vai ate {service.MAX_MONTHS} meses")
    return service.monthly(db, user.id, filters)


@router.get("/by-category", response_model=GroupedReportOut)
def get_by_category(
    filters: service.ReportFilters = Depends(report_filters),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.grouped(db, user.id, filters, "category")


@router.get("/by-tag", response_model=GroupedReportOut)
def get_by_tag(
    filters: service.ReportFilters = Depends(report_filters),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.grouped(db, user.id, filters, "tag")


@router.get("/by-budget", response_model=GroupedReportOut)
def get_by_budget(
    filters: service.ReportFilters = Depends(report_filters),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.grouped(db, user.id, filters, "budget")


@router.get("/by-account", response_model=GroupedReportOut)
def get_by_account(
    filters: service.ReportFilters = Depends(report_filters),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return service.grouped(db, user.id, filters, "account")
