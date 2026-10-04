import datetime as dt
import re
import uuid
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

Money = Annotated[Decimal, Field(max_digits=18, decimal_places=2)]
PositiveMoney = Annotated[Decimal, Field(max_digits=18, decimal_places=2, gt=0)]

_MONTH = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
MIN_YEAR = 2000
MAX_YEAR = 2100


def parse_month(text: str) -> dt.date:
    """"2026-03" vira o primeiro dia do mes. Qualquer outra forma e erro."""
    match = _MONTH.match(text.strip())
    if not match:
        raise ValueError("Informe o mes como AAAA-MM")
    year, month = int(match.group(1)), int(match.group(2))
    if not MIN_YEAR <= year <= MAX_YEAR:
        raise ValueError(f"O ano precisa estar entre {MIN_YEAR} e {MAX_YEAR}")
    return dt.date(year, month, 1)


class EnvelopeOut(BaseModel):
    budget_id: uuid.UUID
    name: str
    # O que passou do mes anterior (nunca negativo)
    carried: Money
    # O que foi distribuido neste mes (pode ser negativo)
    allocated: Money
    spent: Money
    # carried + allocated - spent. Negativo = estourou
    available: Money
    # Quanto estourou (positivo), ou zero
    overspent: Money


class EnvelopeGroupOut(BaseModel):
    currency_code: str
    # Dinheiro nas contas que entram nos envelopes, menos o reservado em cofrinhos, ate o fim do mes
    money: Money
    # Soma do que esta guardado nos envelopes (so os saldos positivos)
    in_envelopes: Money
    # money - in_envelopes. Negativo quando a pessoa distribuiu mais do que tem
    to_budget: Money
    envelopes: list[EnvelopeOut]


class EnvelopeMonthOut(BaseModel):
    # Primeiro dia do mes
    month: dt.date
    groups: list[EnvelopeGroupOut]


class AllocationSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Quanto distribuir neste mes. Pode ser negativo (tirar do que passou do mes anterior); zero limpa.
    amount: Money


class EnvelopeMove(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_budget_id: uuid.UUID
    to_budget_id: uuid.UUID
    # "AAAA-MM"
    month: str
    amount: PositiveMoney

    @field_validator("month")
    @classmethod
    def valid_month(cls, value: str) -> str:
        parse_month(value)
        return value
