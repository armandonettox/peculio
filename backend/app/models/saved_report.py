import datetime as dt
import enum
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Date, DateTime, Enum, ForeignKey, Index, String, Uuid, func, literal_column
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ReportGroupBy(enum.StrEnum):
    category = "category"
    tag = "tag"
    budget = "budget"
    account = "account"
    counterparty = "counterparty"
    month = "month"


class ReportChart(enum.StrEnum):
    table = "table"
    bar = "bar"
    line = "line"
    donut = "donut"


class ReportMeasure(enum.StrEnum):
    expense = "expense"
    income = "income"
    net = "net"


class ReportPeriod(enum.StrEnum):
    """Os periodos prontos (os mesmos do `period=` dos relatorios) e as datas fixas."""

    this_month = "this-month"
    last_month = "last-month"
    this_year = "this-year"
    last_3_months = "last-3-months"
    last_12_months = "last-12-months"
    fixed = "fixed"


def _enum(kind: type[enum.StrEnum]):
    # Guarda o texto da API (ex: "this-month"), nao o nome do membro do Python
    return Enum(kind, native_enum=False, length=16, values_callable=lambda members: [member.value for member in members])


class SavedReport(Base):
    """Um relatorio personalizado salvo: como agrupar, o que medir, o grafico, o periodo e os filtros. Os filtros
    guardam so o id: se a conta, categoria, tag ou orcamento deixar de existir, o relatorio avisa em vez de mostrar tudo."""

    __tablename__ = "saved_reports"
    __table_args__ = (
        CheckConstraint("(period = 'fixed') = (date_from IS NOT NULL AND date_to IS NOT NULL)", name="dates_match_period"),
        CheckConstraint("date_from IS NULL OR date_to IS NULL OR date_from <= date_to", name="dates_in_order"),
        Index("uq_saved_reports_user_id_lower_name", "user_id", literal_column("lower(name)"), unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    group_by: Mapped[ReportGroupBy] = mapped_column(_enum(ReportGroupBy))
    chart: Mapped[ReportChart] = mapped_column(_enum(ReportChart))
    measure: Mapped[ReportMeasure] = mapped_column(_enum(ReportMeasure))
    period: Mapped[ReportPeriod] = mapped_column(_enum(ReportPeriod))
    # So no periodo "fixed"
    date_from: Mapped[dt.date | None] = mapped_column(Date)
    date_to: Mapped[dt.date | None] = mapped_column(Date)
    account_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    tag_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    budget_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
