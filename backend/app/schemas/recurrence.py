import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.recurrence import RecurrenceFrequency
from app.schemas.transaction import TransactionCreate


def _strip_name(value: str | None) -> str | None:
    if value is None:
        return value
    value = value.strip()
    if not value:
        raise ValueError("Informe o nome")
    return value


class RecurrenceCreate(BaseModel):
    """`template` e um lancamento comum. A data de cada linha dele e trocada pela data de cada
    ocorrencia, entao quem escreve so precisa de um valor valido."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    frequency: RecurrenceFrequency
    first_date: date
    end_date: date | None = None
    max_occurrences: int | None = Field(default=None, ge=1, le=100000)
    template: TransactionCreate

    _strip_name = field_validator("name")(_strip_name)

    @model_validator(mode="after")
    def check_end(self):
        if self.end_date is not None and self.max_occurrences is not None:
            raise ValueError("Informe so a data final ou so o numero de repeticoes")
        if self.end_date is not None and self.end_date < self.first_date:
            raise ValueError("A data final nao pode ser antes da primeira")
        return self


class RecurrenceUpdate(BaseModel):
    """A frequencia e a primeira data nao mudam: elas definem todas as datas que ja foram criadas.
    `end_date` e `max_occurrences` enviados como null tiram o fim."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    active: bool | None = None
    end_date: date | None = None
    max_occurrences: int | None = Field(default=None, ge=1, le=100000)
    template: TransactionCreate | None = None

    _strip_name = field_validator("name")(_strip_name)


class RecurrenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    frequency: RecurrenceFrequency
    first_date: date
    end_date: date | None
    max_occurrences: int | None
    active: bool
    template: TransactionCreate
    # Quantos lancamentos ja foram criados
    created_count: int
    # Data do proximo; vazia quando a recorrente terminou
    next_date: date | None
    ended: bool
    last_error: str | None
    created_at: datetime


class RunResult(BaseModel):
    created: int
