import uuid
import datetime as dt
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, UniqueConstraint, Uuid, func, Date
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Reconciliation(Base):
    """Uma conciliacao fechada: a conta bateu com o saldo do extrato naquela data. Os lancamentos conferidos ate la
    ficam travados (AccountClearing.reconciliation_id aponta para ela)."""

    __tablename__ = "reconciliations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    statement_date: Mapped[dt.date] = mapped_column(Date)
    statement_balance: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Preenchido quando algum lancamento dela e destravado: a conciliacao deixa de valer, mas fica no historico
    invalidated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AccountClearing(Base):
    """O lancamento (split) foi conferido com o extrato, do ponto de vista de uma conta. Um split tem dois lados
    (origem e destino), entao a conferencia e por conta. Sem `reconciliation_id` esta so conferido; com ele, travado."""

    __tablename__ = "account_clearings"
    __table_args__ = (UniqueConstraint("split_id", "account_id", name="uq_account_clearings_split_id_account_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    split_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("transaction_splits.id", ondelete="CASCADE"))
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    reconciliation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reconciliations.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
