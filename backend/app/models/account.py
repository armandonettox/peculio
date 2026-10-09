import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid, func, true
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AccountType(enum.StrEnum):
    # Contas do usuario
    asset = "asset"
    liability = "liability"
    # Contrapartes das transacoes (o "Supermercado" de uma despesa). Nascem sozinhas.
    expense = "expense"
    revenue = "revenue"
    # Contas de sistema, nunca aparecem nas listas
    initial_balance = "initial_balance"
    reconciliation = "reconciliation"


class AccountRole(enum.StrEnum):
    # asset
    checking = "checking"
    savings = "savings"
    cash = "cash"
    credit_card = "credit_card"
    other = "other"
    # liability
    loan = "loan"
    debt = "debt"
    mortgage = "mortgage"


ASSET_ROLES = {AccountRole.checking, AccountRole.savings, AccountRole.cash, AccountRole.credit_card, AccountRole.other}
LIABILITY_ROLES = {AccountRole.loan, AccountRole.debt, AccountRole.mortgage}

# Tipos que o usuario cria e edita nas telas de contas
USER_ACCOUNT_TYPES = (AccountType.asset, AccountType.liability)


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("user_id", "type", "name", name="uq_accounts_user_type_name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[AccountType] = mapped_column(Enum(AccountType, native_enum=False, length=32))
    role: Mapped[AccountRole | None] = mapped_column(Enum(AccountRole, native_enum=False, length=32))
    currency_code: Mapped[str] = mapped_column(ForeignKey("currencies.code"))
    # Arquivar esconde a conta das listas sem apagar o historico
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    # O dinheiro desta conta entra no "A orcar" dos envelopes (so conta de ativo conta)
    in_envelopes: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    iban: Mapped[str | None] = mapped_column(String(34))
    account_number: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(Text)
    # So fazem sentido com role=credit_card: dia do fechamento da fatura e dia do vencimento
    closing_day: Mapped[int | None] = mapped_column(Integer)
    due_day: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
