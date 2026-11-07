import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# So saida e entrada tem descricao favorita (transferencia nao)
FavoriteType = Literal["withdrawal", "deposit"]


class FavoriteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: FavoriteType
    description: str = Field(min_length=1, max_length=255)
    category_id: uuid.UUID | None = None
    account_id: uuid.UUID | None = None

    @field_validator("description")
    @classmethod
    def strip_description(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Informe a descricao")
        return value


class FavoriteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: FavoriteType
    description: str
    category_id: uuid.UUID | None
    account_id: uuid.UUID | None
    created_at: datetime


class SuggestionOut(BaseModel):
    """Uma sugestao ao digitar a descricao: um favorito, ou algo que ja foi lancado antes."""

    description: str
    category_id: uuid.UUID | None
    account_id: uuid.UUID | None
    # Preenchido quando a sugestao e um favorito
    favorite_id: uuid.UUID | None
