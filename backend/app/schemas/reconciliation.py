import datetime as dt
import uuid
from typing import Annotated

from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core import clock

Money = Annotated[Decimal, Field(max_digits=18, decimal_places=2)]

# Quantos lancamentos a tela de conciliacao traz de uma vez
MAX_ROWS = 1000


class StatementIn(BaseModel):
    """O que a pessoa leu no extrato: o saldo e a data dele."""

    model_config = ConfigDict(extra="forbid")

    statement_balance: Money
    statement_date: dt.date

    @field_validator("statement_date")
    @classmethod
    def not_in_the_future(cls, value: dt.date) -> dt.date:
        if value > clock.today():
            raise ValueError("A data do extrato nao pode ser no futuro")
        return value


class ClearedSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    split_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_ROWS)
    cleared: bool


class SplitIds(BaseModel):
    model_config = ConfigDict(extra="forbid")

    split_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_ROWS)


class ReconRowOut(BaseModel):
    split_id: uuid.UUID
    transaction_id: uuid.UUID
    date: dt.date
    description: str
    # Efeito na conta: positivo entrou, negativo saiu
    amount: Money
    cleared: bool


class ReconciliationViewOut(BaseModel):
    account_id: uuid.UUID
    account_name: str
    currency_code: str
    statement_date: dt.date
    statement_balance: Money
    # Saldo inicial mais tudo o que foi conferido ate a data do extrato
    cleared_balance: Money
    # statement_balance - cleared_balance. Zero = pode fechar
    difference: Money
    # Saldo da conta nos livros na data do extrato (conferido ou nao)
    book_balance: Money
    reconciled: bool
    rows: list[ReconRowOut]
    # Quantos lancamentos abertos existem ate a data (pode ser mais do que `rows` traz)
    total_rows: int
    truncated: bool


class ChangedOut(BaseModel):
    changed: int


class ReconciliationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    account_id: uuid.UUID
    statement_date: dt.date
    statement_balance: Money
    closed_at: dt.datetime
    invalidated_at: dt.datetime | None
    # Quantos lancamentos esta conciliacao trava (zero depois de desfeita)
    locked_count: int
