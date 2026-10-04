import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.api_token import ApiTokenScope

# Validade maxima escolhida na criacao: 10 anos. Vazio = nunca expira.
MAX_EXPIRES_DAYS = 3650


class ApiTokenCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    scope: ApiTokenScope
    # Quantos dias o token vale a partir de agora. Vazio = nunca expira.
    expires_in_days: int | None = Field(default=None, ge=1, le=MAX_EXPIRES_DAYS)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("O nome nao pode ser vazio")
        return value


class ApiTokenOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    # Comeco do token (ex: "fin_ab12cd34"): serve so para reconhecer qual e qual na lista
    prefix: str
    scope: ApiTokenScope
    expires_at: dt.datetime | None
    last_used_at: dt.datetime | None
    created_at: dt.datetime
    # Ja passou da validade (continua na lista ate ser revogado)
    expired: bool


class ApiTokenCreated(ApiTokenOut):
    # O valor completo: aparece so nesta resposta e nunca mais
    token: str
