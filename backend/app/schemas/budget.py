import uuid
from datetime import date, datetime
from typing import Annotated

from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.budget import BudgetMode, BudgetPeriod

Money = Annotated[Decimal, Field(max_digits=18, decimal_places=2)]
PositiveMoney = Annotated[Decimal, Field(max_digits=18, decimal_places=2, gt=0)]


def _strip(value: str | None) -> str | None:
    if value is None:
        return value
    value = value.strip()
    if not value:
        raise ValueError("Informe o nome")
    return value


class BudgetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    currency_code: str = Field(min_length=3, max_length=3)
    # O modo nao muda depois de criado. Limite fixo precisa de limite e periodo; envelope nao tem limite (o valor
    # de cada mes e a distribuicao) e e sempre mensal.
    mode: BudgetMode = BudgetMode.fixed
    amount: PositiveMoney | None = None
    period: BudgetPeriod | None = None

    _strip_name = field_validator("name")(_strip)

    @field_validator("currency_code")
    @classmethod
    def upper_currency(cls, value: str) -> str:
        return value.strip().upper()

    @model_validator(mode="after")
    def check_mode(self):
        if self.mode == BudgetMode.fixed:
            if self.amount is None or self.period is None:
                raise ValueError("Informe o limite e o periodo")
        else:
            if self.amount is not None:
                raise ValueError("Envelope nao tem limite: voce distribui um valor por mes")
            if self.period not in (None, BudgetPeriod.monthly):
                raise ValueError("Envelope e sempre mensal")
        return self


class BudgetUpdate(BaseModel):
    """A moeda nao muda: lancamentos em outra moeda nao contariam para o limite."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    amount: PositiveMoney | None = None
    period: BudgetPeriod | None = None
    active: bool | None = None

    _strip_name = field_validator("name")(_strip)


class BudgetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    currency_code: str
    mode: BudgetMode
    # Vazio no envelope
    amount: Money | None
    period: BudgetPeriod
    active: bool
    created_at: datetime


class BudgetProgressOut(BudgetOut):
    """O orcamento com o gasto do periodo que contem a data pedida."""

    period_start: date
    period_end: date
    spent: Money
    # Pode ser negativo: gastou alem do limite
    remaining: Money
    # Parte inteira de gasto / limite, em %. Chega a 100 so quando o limite foi atingido.
    percent: int
