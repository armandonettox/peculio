import uuid
from datetime import date, datetime
from datetime import date as DateType
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.labels import Color

Money = Annotated[Decimal, Field(max_digits=18, decimal_places=2)]
PositiveMoney = Annotated[Decimal, Field(max_digits=18, decimal_places=2, gt=0)]


# Icones que um objetivo pode ter: nomes do lucide-react em minusculas com hifen. A tela mapeia cada nome para o desenho
# (frontend/src/features/piggy-banks/goal-icons.ts); o tipo gerado da API garante que as duas listas batem.
GoalIcon = Literal[
    "target",
    "shield",
    "car",
    "house",
    "hammer",
    "plane",
    "heart-pulse",
    "wallet",
    "graduation-cap",
    "gift",
    "laptop",
    "piggy-bank",
]


def _upper_color(value: str | None) -> str | None:
    return value.upper() if value else value


def _blank_to_none(value: str | None) -> str | None:
    return (value.strip() or None) if value else None


def _strip_name(value: str | None) -> str | None:
    if value is None:
        return value
    value = value.strip()
    if not value:
        raise ValueError("Informe o nome")
    return value


class PiggyBankCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    account_id: uuid.UUID
    target_amount: PositiveMoney
    target_date: date | None = None
    color: Color | None = None
    icon: GoalIcon | None = None
    description: str | None = Field(default=None, max_length=300)
    # Valor que ja entra guardado (como o "valor inicial" do Mobills). Vira o primeiro movimento de guardar, entao segue
    # a regra de sempre: nao passa do disponivel na conta.
    initial_amount: PositiveMoney | None = None

    _strip_name = field_validator("name")(_strip_name)
    _upper_color = field_validator("color")(_upper_color)
    _blank_description = field_validator("description")(_blank_to_none)


class PiggyBankUpdate(BaseModel):
    """A conta nao muda: o guardado so faz sentido nela. `target_date` enviado como null tira a data."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    target_amount: PositiveMoney | None = None
    target_date: date | None = None
    # false arquiva (o guardado continua reservado); true desarquiva
    active: bool | None = None
    # null limpa (cor, icone e descricao); omitir nao mexe
    color: Color | None = None
    icon: GoalIcon | None = None
    description: str | None = Field(default=None, max_length=300)

    _strip_name = field_validator("name")(_strip_name)
    _upper_color = field_validator("color")(_upper_color)
    _blank_description = field_validator("description")(_blank_to_none)


class PiggyBankOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    account_id: uuid.UUID
    account_name: str
    currency_code: str
    target_amount: Money
    target_date: date | None
    color: str | None
    icon: str | None
    description: str | None
    active: bool
    # Soma dos movimentos
    saved: Money
    # Quanto falta para a meta; zero quando ja chegou (nunca negativo)
    remaining: Money
    # Parte inteira de guardado / meta, em %; passa de 100 se guardou alem da meta
    percent: int
    # Quanto guardar por mes ate a data alvo, arredondado para cima. Vazio sem data, com a data
    # vencida ou com a meta atingida.
    suggested_per_month: Money | None
    # Saldo da conta menos tudo o que esta guardado nos cofrinhos dela. Negativo quando o saldo caiu
    # abaixo do reservado.
    account_available: Money
    created_at: datetime


class PiggyBankEventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["add", "remove"]
    amount: PositiveMoney
    # Vazio: hoje. Nao pode ser futura.
    date: DateType | None = None
    note: str | None = Field(default=None, max_length=200)

    @field_validator("note")
    @classmethod
    def blank_note_is_none(cls, value: str | None) -> str | None:
        return (value.strip() or None) if value else None


class PiggyBankEventOut(BaseModel):
    id: uuid.UUID
    kind: Literal["add", "remove"]
    # Sempre positivo; o sentido esta em `kind`
    amount: Money
    date: DateType
    note: str | None
    created_at: datetime
