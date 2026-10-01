import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, ForeignKey, Index, Numeric, String, Uuid, func, true
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class BudgetPeriod(enum.StrEnum):
    weekly = "weekly"
    monthly = "monthly"
    yearly = "yearly"


class Budget(Base):
    """Limite de gasto que se repete a cada periodo. O gasto nunca e guardado: e somado dos
    lancamentos ligados ao orcamento, como os saldos das contas."""

    __tablename__ = "budgets"
    __table_args__ = (CheckConstraint("amount > 0", name="amount_positive"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    # A moeda nao muda depois de criado: so lancamentos nela contam para o limite
    currency_code: Mapped[str] = mapped_column(ForeignKey("currencies.code"))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    period: Mapped[BudgetPeriod] = mapped_column(Enum(BudgetPeriod, native_enum=False, length=16))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Nome unico por usuario sem diferenciar maiuscula de minuscula, garantido pelo banco
Index("uq_budgets_user_id_lower_name", Budget.user_id, func.lower(Budget.name), unique=True)
