import enum
import uuid
import datetime as dt
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
    Uuid,
    false,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class BudgetPeriod(enum.StrEnum):
    weekly = "weekly"
    monthly = "monthly"
    yearly = "yearly"
    # Um intervalo de datas escolhido, que nao se repete (Planejamento Personalizado)
    custom = "custom"


class Budget(Base):
    """Limite de gasto que se repete a cada periodo. O gasto nunca e guardado: e somado dos lancamentos
    ligados ao orcamento, como os saldos das contas. Quando `carry_over` esta ligado, a sobra (ou o
    estouro) de um mes passa para o limite do mes seguinte, em cadeia."""

    __tablename__ = "budgets"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        # So faz sentido carregar sobra mes a mes
        CheckConstraint("NOT carry_over OR period = 'monthly'", name="carry_over_is_monthly"),
        # Periodo personalizado tem as duas datas; os outros nao tem nenhuma
        CheckConstraint(
            "(period = 'custom') = (start_date IS NOT NULL AND end_date IS NOT NULL)", name="custom_period_has_dates"
        ),
        CheckConstraint("(start_date IS NULL) = (end_date IS NULL)", name="dates_come_together"),
        CheckConstraint("start_date IS NULL OR start_date <= end_date", name="dates_in_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    # A moeda nao muda depois de criado: so lancamentos nela contam para o limite
    currency_code: Mapped[str] = mapped_column(ForeignKey("currencies.code"))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    period: Mapped[BudgetPeriod] = mapped_column(Enum(BudgetPeriod, native_enum=False, length=16))
    # A sobra (ou o estouro) do mes passa para o limite do mes seguinte
    carry_over: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    # So no periodo personalizado: primeiro e ultimo dia (inclusive)
    start_date: Mapped[dt.date | None] = mapped_column(Date, default=None)
    end_date: Mapped[dt.date | None] = mapped_column(Date, default=None)
    # Marca o orcamento quando chega perto do limite (80%) ou passa dele
    alert: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Nome unico por usuario sem diferenciar maiuscula de minuscula, garantido pelo banco
Index("uq_budgets_user_id_lower_name", Budget.user_id, func.lower(Budget.name), unique=True)


class BudgetCategory(Base):
    """Uma categoria que conta para o orcamento: o gasto nela entra no limite sem precisar ligar lancamento a lancamento."""

    __tablename__ = "budget_categories"

    budget_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("budgets.id", ondelete="CASCADE"), primary_key=True)
    # Apagar a categoria tira ela do orcamento
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"), primary_key=True, index=True)
