import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models.category import CategoryKind

# Cor no formato #RRGGBB; a API devolve sempre em maiusculas
Color = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")]


# Icones que uma categoria pode ter: nomes do lucide-react em minusculas com hifen. A tela mapeia cada nome para o
# desenho (frontend/src/features/labels/category-icons.ts); o tipo gerado da API garante que as duas listas batem.
CategoryIcon = Literal[
    "house",
    "shopping-cart",
    "utensils",
    "coffee",
    "pizza",
    "car",
    "fuel",
    "bus",
    "plane",
    "heart-pulse",
    "dumbbell",
    "baby",
    "paw-print",
    "graduation-cap",
    "book-open",
    "gamepad-2",
    "film",
    "music",
    "shirt",
    "gift",
    "wifi",
    "phone",
    "zap",
    "droplet",
    "wrench",
    "receipt",
    "briefcase",
    "wallet",
    "banknote",
    "hand-coins",
    "piggy-bank",
    "trending-up",
    "landmark",
    "tag",
]


def _strip(value: str | None) -> str | None:
    if value is None:
        return value
    value = value.strip()
    if not value:
        raise ValueError("Informe o nome")
    return value


class CategoryCreate(BaseModel):
    # forbid: campo desconhecido vira erro, em vez de ser ignorado em silencio
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    kind: CategoryKind
    color: Color | None = None
    icon: CategoryIcon | None = None

    _strip_name = field_validator("name")(_strip)

    @field_validator("color")
    @classmethod
    def upper_color(cls, value: str | None) -> str | None:
        return value.upper() if value else value


class CategoryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    # Trocar o tipo de uma categoria ja usada nao desliga ela dos lancamentos antigos (o tipo so
    # vale para lancamentos novos); a pessoa decide se quer mesmo mudar.
    kind: CategoryKind | None = None
    color: Color | None = None
    icon: CategoryIcon | None = None

    _strip_name = field_validator("name")(_strip)

    @field_validator("color")
    @classmethod
    def upper_color(cls, value: str | None) -> str | None:
        return value.upper() if value else value


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    kind: CategoryKind
    color: str | None
    icon: str | None
    created_at: datetime


class TagCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=50)

    _strip_name = field_validator("name")(_strip)


class TagUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=50)

    _strip_name = field_validator("name")(_strip)


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    created_at: datetime
