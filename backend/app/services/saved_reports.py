import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import clock
from app.core.errors import AppError, ErrorCode
from app.models.saved_report import SavedReport
from app.models.user import User
from app.schemas.saved_report import MAX_SAVED_REPORTS, SavedReportIn
from app.services import reports as reports_service


def get_owned_report(db: Session, user_id: uuid.UUID, report_id: uuid.UUID) -> SavedReport:
    """404 tambem quando e de outra pessoa, para nao revelar que existe."""
    report = db.execute(select(SavedReport).where(SavedReport.id == report_id, SavedReport.user_id == user_id)).scalar_one_or_none()
    if not report:
        raise AppError(404, ErrorCode.SAVED_REPORT_NOT_FOUND, "Relatorio nao encontrado")
    return report


def list_reports(db: Session, user_id: uuid.UUID) -> list[SavedReport]:
    return list(
        db.execute(select(SavedReport).where(SavedReport.user_id == user_id).order_by(func.lower(SavedReport.name), SavedReport.id)).scalars()
    )


def _check_name_free(db: Session, user_id: uuid.UUID, name: str, own_id: uuid.UUID | None = None) -> None:
    statement = select(SavedReport.id).where(SavedReport.user_id == user_id, func.lower(SavedReport.name) == name.lower())
    if own_id is not None:
        statement = statement.where(SavedReport.id != own_id)
    if db.scalar(statement):
        raise AppError(409, ErrorCode.SAVED_REPORT_NAME_TAKEN, "Ja existe um relatorio com esse nome")


def _check_filters(db: Session, user_id: uuid.UUID, data: SavedReportIn) -> None:
    """A conta, categoria, tag ou orcamento escolhidos precisam ser da pessoa (404 como nos relatorios)."""
    today = clock.today()
    reports_service.check_filters_owned(
        db,
        user_id,
        reports_service.ReportFilters(
            date_from=today,
            date_to=today,
            account_id=data.account_id,
            category_id=data.category_id,
            tag_id=data.tag_id,
            budget_id=data.budget_id,
        ),
    )


def _apply(report: SavedReport, data: SavedReportIn) -> None:
    report.name = data.name
    report.group_by = data.group_by
    report.chart = data.chart
    report.measure = data.measure
    report.period = data.period
    report.date_from = data.date_from
    report.date_to = data.date_to
    report.account_id = data.account_id
    report.category_id = data.category_id
    report.tag_id = data.tag_id
    report.budget_id = data.budget_id


def create_report(db: Session, user: User, data: SavedReportIn) -> SavedReport:
    count = db.scalar(select(func.count()).select_from(SavedReport).where(SavedReport.user_id == user.id))
    if count >= MAX_SAVED_REPORTS:
        raise AppError(
            409,
            ErrorCode.SAVED_REPORT_LIMIT_REACHED,
            f"Voce chegou ao limite de {MAX_SAVED_REPORTS} relatorios salvos. Exclua algum para salvar outro",
        )
    _check_name_free(db, user.id, data.name)
    _check_filters(db, user.id, data)
    report = SavedReport(user_id=user.id)
    _apply(report, data)
    db.add(report)
    db.flush()
    db.refresh(report)
    return report


def update_report(db: Session, user: User, report: SavedReport, data: SavedReportIn) -> SavedReport:
    _check_name_free(db, user.id, data.name, own_id=report.id)
    _check_filters(db, user.id, data)
    _apply(report, data)
    db.flush()
    db.refresh(report)
    return report


def remove_report(db: Session, report: SavedReport) -> None:
    db.delete(report)
    db.flush()
