import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Table,
    Text,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TransactionType(enum.StrEnum):
    withdrawal = "withdrawal"
    deposit = "deposit"
    transfer = "transfer"
    # Saldo com que a conta comecou. Sai de uma conta de sistema para a conta do usuario.
    opening_balance = "opening_balance"
    reconciliation = "reconciliation"


class Transaction(Base):
    """Grupo de uma transacao. Uma compra dividida em duas categorias e um grupo com 2 splits."""

    __tablename__ = "transactions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TransactionSplit(Base):
    """Cada linha move dinheiro de uma conta (origem) para outra (destino): partida dobrada."""

    __tablename__ = "transaction_splits"
    __table_args__ = (
        # Valor sempre positivo; o sentido do dinheiro esta em origem e destino
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("source_account_id <> destination_account_id", name="source_differs_from_destination"),
        # Valor em moeda estrangeira vem completo (valor e moeda) ou nao vem
        CheckConstraint(
            "(foreign_amount IS NULL) = (foreign_currency_code IS NULL)", name="foreign_amount_and_currency_together"
        ),
        CheckConstraint("foreign_amount IS NULL OR foreign_amount > 0", name="foreign_amount_positive"),
        # O saldo de uma conta soma entradas e saidas por data
        Index("ix_transaction_splits_source_account_id_date", "source_account_id", "date"),
        Index("ix_transaction_splits_destination_account_id_date", "destination_account_id", "date"),
        Index("ix_transaction_splits_user_id_date", "user_id", "date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    transaction_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("transactions.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[TransactionType] = mapped_column(Enum(TransactionType, native_enum=False, length=32))
    date: Mapped[date] = mapped_column(Date)
    description: Mapped[str] = mapped_column(String(255))
    # Ordem em que o usuario escreveu os splits do grupo. Sem isso a ordem seria a do UUID (aleatoria).
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # RESTRICT: o banco recusa apagar uma conta que tem movimento
    source_account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"))
    destination_account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency_code: Mapped[str] = mapped_column(ForeignKey("currencies.code"))
    foreign_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    foreign_currency_code: Mapped[str | None] = mapped_column(ForeignKey("currencies.code"))
    # Categoria do split (uma por linha, para a divisao da compra entre categorias)
    category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Tags do split: N:N, um split pode ter varias tags e uma tag aparece em varios splits
transaction_split_tags = Table(
    "transaction_split_tags",
    Base.metadata,
    Column("transaction_split_id", ForeignKey("transaction_splits.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)
