import enum
import uuid
from datetime import date, datetime
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
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class BillFrequency(enum.StrEnum):
    weekly = "weekly"
    monthly = "monthly"
    quarterly = "quarterly"
    half_yearly = "half_yearly"
    yearly = "yearly"


class Bill(Base):
    """Conta a pagar que se repete (aluguel, assinatura). O que ja foi pago nao e guardado aqui:
    sai dos lancamentos ligados a ela."""

    __tablename__ = "bills"
    __table_args__ = (
        CheckConstraint("amount_min > 0", name="amount_min_positive"),
        CheckConstraint("amount_max >= amount_min", name="amount_max_at_least_min"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    # A moeda nao muda depois de criada: so lancamentos nela podem ser ligados
    currency_code: Mapped[str] = mapped_column(ForeignKey("currencies.code"))
    amount_min: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    amount_max: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    # Trecho procurado na descricao ou no nome de quem recebeu, para ligar sozinho. Vazio: so liga a mao.
    match_text: Mapped[str | None] = mapped_column(String(100))
    # Primeiro vencimento; os seguintes saem dele e da frequencia
    first_due_date: Mapped[date] = mapped_column(Date)
    frequency: Mapped[BillFrequency] = mapped_column(Enum(BillFrequency, native_enum=False, length=16))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


Index("uq_bills_user_id_lower_name", Bill.user_id, func.lower(Bill.name), unique=True)
