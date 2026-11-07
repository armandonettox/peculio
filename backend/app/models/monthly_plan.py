import datetime as dt
import enum
import uuid
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.budget import BudgetAlertLevel


class CardCounting(enum.StrEnum):
    # A compra no cartao conta no mes da data da compra
    purchase = "purchase"
    # A compra no cartao conta no mes do vencimento da fatura dela
    invoice = "invoice"


class MonthlyPlan(Base):
    """Planejamento de um mes: quanto a pessoa ganha, quanto quer economizar e, por categoria, quanto pode gastar.
    O que foi gasto nunca e guardado: e somado dos lancamentos do mes, como os saldos das contas."""

    __tablename__ = "monthly_plans"
    __table_args__ = (
        UniqueConstraint("user_id", "month", name="uq_monthly_plans_user_id_month"),
        CheckConstraint("income >= 0", name="income_not_negative"),
        CheckConstraint("savings_percent >= 0 AND savings_percent <= 100", name="savings_percent_range"),
        # O mes e sempre guardado como o dia 1
        CheckConstraint("EXTRACT(day FROM month) = 1", name="month_is_first_day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    month: Mapped[dt.date] = mapped_column(Date)
    # So lancamentos nesta moeda contam para o planejamento
    currency_code: Mapped[str] = mapped_column(ForeignKey("currencies.code"))
    # Quanto a pessoa ganha por mes (o que ela informou; a receita de verdade vem dos lancamentos)
    income: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    savings_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("20"), server_default="20")
    card_counting: Mapped[CardCounting] = mapped_column(
        Enum(CardCounting, native_enum=False, length=16), default=CardCounting.purchase, server_default="purchase"
    )
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MonthlyPlanItem(Base):
    """O limite de uma categoria dentro de um planejamento mensal."""

    __tablename__ = "monthly_plan_items"
    __table_args__ = (
        UniqueConstraint("plan_id", "category_id", name="uq_monthly_plan_items_plan_id_category_id"),
        CheckConstraint("amount > 0", name="amount_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("monthly_plans.id", ondelete="CASCADE"), index=True)
    # Apagar a categoria tira o limite dela do planejamento
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    # Avisar quando o gasto chegar perto do limite
    alert: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # Ate onde o aviso (webhook budget.alert) ja foi dado neste mes: avisa quando o nivel sobe, nao a cada lancamento
    alert_level: Mapped[BudgetAlertLevel] = mapped_column(
        Enum(BudgetAlertLevel, native_enum=False, length=8), default=BudgetAlertLevel.none, server_default="none"
    )
