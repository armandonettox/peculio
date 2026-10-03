import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.bill import BillFrequency

Money = Annotated[Decimal, Field(max_digits=18, decimal_places=2)]
PositiveMoney = Annotated[Decimal, Field(max_digits=18, decimal_places=2, gt=0)]


def _strip_name(value: str | None) -> str | None:
    if value is None:
        return value
    value = value.strip()
    if not value:
        raise ValueError("Informe o nome")
    return value


def _strip_match(value: str | None) -> str | None:
    # Texto em branco vale como "sem ligacao automatica"
    if value is None:
        return None
    return value.strip() or None


class BillCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    currency_code: str = Field(min_length=3, max_length=3)
    amount_min: PositiveMoney
    amount_max: PositiveMoney
    match_text: str | None = Field(default=None, max_length=100)
    first_due_date: date
    frequency: BillFrequency

    _strip_name = field_validator("name")(_strip_name)
    _strip_match = field_validator("match_text")(_strip_match)

    @field_validator("currency_code")
    @classmethod
    def upper_currency(cls, value: str) -> str:
        return value.strip().upper()

    @model_validator(mode="after")
    def check_range(self):
        if self.amount_max < self.amount_min:
            raise ValueError("O valor maximo nao pode ser menor que o minimo")
        return self


class BillUpdate(BaseModel):
    """A moeda nao muda. `match_text` enviado como null apaga a ligacao automatica."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    amount_min: PositiveMoney | None = None
    amount_max: PositiveMoney | None = None
    match_text: str | None = Field(default=None, max_length=100)
    first_due_date: date | None = None
    frequency: BillFrequency | None = None
    active: bool | None = None

    _strip_name = field_validator("name")(_strip_name)
    _strip_match = field_validator("match_text")(_strip_match)


class BillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    currency_code: str
    amount_min: Money
    amount_max: Money
    match_text: str | None
    first_due_date: date
    frequency: BillFrequency
    active: bool
    created_at: datetime


BillStatus = Literal["upcoming", "paid", "overdue"]


class BillStatusOut(BillOut):
    """A conta a pagar com a situacao na data pedida."""

    # Ultimo vencimento ate a data (inclusive); vazio se o primeiro ainda nao chegou
    last_due_date: date | None
    # Primeiro vencimento depois da data
    next_due_date: date
    # upcoming: o primeiro vencimento ainda nao chegou; paid: o ultimo foi pago; overdue: nao foi
    status: BillStatus
    # Vencimentos seguidos sem pagar ate o ultimo (0 se nao esta atrasada) e a data do mais antigo deles
    overdue_count: int
    oldest_overdue_date: date | None
    # O proximo vencimento ja foi pago adiantado
    next_due_paid: bool
