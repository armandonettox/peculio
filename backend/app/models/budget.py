import enum
import uuid
import datetime as dt
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    Uuid,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class BudgetPeriod(enum.StrEnum):
    weekly = "weekly"
    monthly = "monthly"
    yearly = "yearly"


class BudgetMode(enum.StrEnum):
    # Limite fixo que se repete a cada periodo (o orcamento de sempre)
    fixed = "fixed"
    # Envelope: a pessoa distribui um valor por mes e a sobra passa para o mes seguinte (sempre mensal, sem limite)
    envelope = "envelope"


class Budget(Base):
    """Limite de gasto que se repete a cada periodo, ou envelope mensal. O gasto nunca e guardado: e somado dos
    lancamentos ligados ao orcamento, como os saldos das contas."""

    __tablename__ = "budgets"
    __table_args__ = (
        CheckConstraint("amount IS NULL OR amount > 0", name="amount_positive"),
        # Limite fixo tem limite; envelope nao tem
        CheckConstraint("(mode = 'fixed') = (amount IS NOT NULL)", name="mode_matches_amount"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    # A moeda nao muda depois de criado: so lancamentos nela contam para o limite
    currency_code: Mapped[str] = mapped_column(ForeignKey("currencies.code"))
    # Vazio no envelope: o valor de cada mes e a distribuicao (BudgetAllocation)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    period: Mapped[BudgetPeriod] = mapped_column(Enum(BudgetPeriod, native_enum=False, length=16))
    mode: Mapped[BudgetMode] = mapped_column(
        Enum(BudgetMode, native_enum=False, length=16), default=BudgetMode.fixed, server_default=BudgetMode.fixed.value
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Nome unico por usuario sem diferenciar maiuscula de minuscula, garantido pelo banco
Index("uq_budgets_user_id_lower_name", Budget.user_id, func.lower(Budget.name), unique=True)


class BudgetAllocation(Base):
    """Quanto a pessoa distribuiu para um envelope em um mes. Pode ser negativo (tirar do que passou do mes
    anterior). Zero nao e guardado: a linha some."""

    __tablename__ = "budget_allocations"
    __table_args__ = (
        UniqueConstraint("budget_id", "month", name="uq_budget_allocations_budget_id_month"),
        CheckConstraint("amount <> 0", name="amount_not_zero"),
        # Sempre o primeiro dia do mes
        CheckConstraint("extract(day from month) = 1", name="month_is_first_day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    budget_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("budgets.id", ondelete="CASCADE"))
    month: Mapped[dt.date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
