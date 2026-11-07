import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field

Money = Annotated[Decimal, Field(max_digits=18, decimal_places=2)]


class InvoiceSplitOut(BaseModel):
    id: uuid.UUID
    date: date
    description: str
    amount: Money
    currency_code: str


class InvoiceOut(BaseModel):
    account_id: uuid.UUID
    currency_code: str
    period_start: date
    period_end: date
    due_date: date
    total: Money
    splits: list[InvoiceSplitOut]


class InvoiceOptionOut(BaseModel):
    """Uma fatura oferecida ao escolher onde lancar uma compra no cartao."""

    period_start: date
    period_end: date
    due_date: date
    total: Money
    # zero: ja fechou e nao teve compras; closed: ja fechou; open: a atual; partial: ainda vai abrir
    status: Literal["zero", "closed", "open", "partial"]
