import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.webhook import DeliveryStatus, WebhookEvent

EventName = Literal["transaction.created", "transaction.updated", "transaction.deleted"]
DeliveryEventName = Literal["transaction.created", "transaction.updated", "transaction.deleted", "webhook.test"]


def _strip_name(value: str | None) -> str | None:
    if value is None:
        return value
    value = value.strip()
    if not value:
        raise ValueError("Informe o nome")
    return value


def _strip_url(value: str | None) -> str | None:
    if value is None:
        return value
    value = value.strip()
    if not value:
        raise ValueError("Informe o endereco")
    return value


def _unique_events(value: list[str] | None) -> list[str] | None:
    if value is None:
        return value
    # Sem repetidos, na ordem em que vieram
    return list(dict.fromkeys(value))


class WebhookCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    url: str = Field(min_length=1, max_length=2048)
    events: list[EventName] = Field(min_length=1, max_length=len(WebhookEvent))
    active: bool = True

    _strip_name = field_validator("name")(_strip_name)
    _strip_url = field_validator("url")(_strip_url)
    _unique_events = field_validator("events")(_unique_events)


class WebhookUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    url: str | None = Field(default=None, min_length=1, max_length=2048)
    events: list[EventName] | None = Field(default=None, min_length=1, max_length=len(WebhookEvent))
    active: bool | None = None

    _strip_name = field_validator("name")(_strip_name)
    _strip_url = field_validator("url")(_strip_url)
    _unique_events = field_validator("events")(_unique_events)


class WebhookOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    url: str
    events: list[EventName]
    active: bool
    created_at: datetime
    # Situacao da entrega mais recente (vazio se ainda nao houve nenhuma) e quando ela foi tentada
    last_delivery_status: DeliveryStatus | None
    last_delivery_at: datetime | None


class WebhookWithSecretOut(WebhookOut):
    """Resposta da criacao e da rotacao: unica vez em que o segredo aparece."""

    secret: str


class DeliveryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    webhook_id: uuid.UUID
    event: DeliveryEventName
    status: DeliveryStatus
    attempts: int
    next_attempt_at: datetime | None
    last_attempt_at: datetime | None
    last_status_code: int | None
    last_error: str | None
    response_excerpt: str | None
    created_at: datetime
    delivered_at: datetime | None
