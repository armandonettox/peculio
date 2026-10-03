import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Numeric, String, Text, Uuid, func, true
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PiggyBank(Base):
    """Cofrinho: um valor reservado dentro de uma conta, sem tirar dinheiro dela. O guardado nao e
    gravado: e a soma dos movimentos."""

    __tablename__ = "piggy_banks"
    __table_args__ = (CheckConstraint("target_amount > 0", name="target_amount_positive"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Sem sentido sem a conta: excluir a conta leva os cofrinhos junto (conta com movimento nem exclui)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    target_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    target_date: Mapped[date | None] = mapped_column(Date)
    # Arquivado some da lista, mas o guardado continua reservado na conta ate ser retirado
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


Index("uq_piggy_banks_user_id_lower_name", PiggyBank.user_id, func.lower(PiggyBank.name), unique=True)


class PiggyBankEvent(Base):
    """Guardar (valor positivo) ou retirar (negativo) dinheiro de um cofrinho."""

    __tablename__ = "piggy_bank_events"
    __table_args__ = (CheckConstraint("amount <> 0", name="amount_not_zero"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    piggy_bank_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("piggy_banks.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    date: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
