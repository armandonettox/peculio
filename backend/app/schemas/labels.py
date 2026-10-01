import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

# Cor no formato #RRGGBB; a API devolve sempre em maiusculas
Color = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")]


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
    color: Color | None = None

    _strip_name = field_validator("name")(_strip)

    @field_validator("color")
    @classmethod
    def upper_color(cls, value: str | None) -> str | None:
        return value.upper() if value else value


class CategoryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    color: Color | None = None

    _strip_name = field_validator("name")(_strip)

    @field_validator("color")
    @classmethod
    def upper_color(cls, value: str | None) -> str | None:
        return value.upper() if value else value


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    color: str | None
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
