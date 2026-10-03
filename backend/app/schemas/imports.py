import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core import clock
from app.core.config import settings
from app.schemas.account import Money
from app.services.import_parsers import MAX_DESCRIPTION, MIN_YEAR

# Uma data alem de um ano no futuro quase sempre e erro de digitacao no extrato
MAX_FUTURE_DAYS = 366


def check_import_date(value: date) -> date:
    if value.year < MIN_YEAR:
        raise ValueError("Data fora do intervalo")
    if value > clock.today() + timedelta(days=MAX_FUTURE_DAYS):
        raise ValueError("Data muito longe no futuro")
    return value


class ImportMapping(BaseModel):
    """Qual coluna do CSV e cada informacao. As colunas contam a partir de 0. O valor vem de uma coluna
    com sinal, ou de duas colunas (debito e credito)."""

    model_config = ConfigDict(extra="forbid")

    date_column: int = Field(ge=0, le=200)
    description_column: int = Field(ge=0, le=200)
    amount_column: int | None = Field(default=None, ge=0, le=200)
    debit_column: int | None = Field(default=None, ge=0, le=200)
    credit_column: int | None = Field(default=None, ge=0, le=200)
    has_header: bool = True


ImportRowStatus = Literal["new", "duplicate", "error"]
# same_id: o banco ja mandou este lancamento (certeza); similar: ja existe um igual (suspeita)
DuplicateKind = Literal["same_id", "similar"]


class ImportRowOut(BaseModel):
    # Numero da linha como a pessoa conta no arquivo
    index: int
    date: date | None
    description: str
    # Com sinal: negativo e saida, positivo e entrada
    amount: Money | None
    external_id: str | None
    status: ImportRowStatus
    duplicate_kind: DuplicateKind | None
    # O motivo, quando a linha tem erro ou parece repetida
    reason: str | None


class ImportCountsOut(BaseModel):
    new: int
    duplicate: int
    error: int


class ImportPreviewOut(BaseModel):
    format: Literal["csv", "ofx"]
    account_id: uuid.UUID
    # So no CSV: nomes das colunas e as primeiras linhas, para a pessoa escolher o que e cada uma
    columns: list[str] | None
    sample: list[list[str]] | None
    # As colunas usadas (as que a pessoa mandou ou as que o servidor adivinhou); vazio se nao deu para adivinhar
    mapping: ImportMapping | None
    # CSV sem mapeamento e sem como adivinhar: a tela pede as colunas e envia de novo
    needs_mapping: bool
    rows: list[ImportRowOut]
    counts: ImportCountsOut


class ImportRowIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    description: str = Field(min_length=1, max_length=MAX_DESCRIPTION)
    # Com sinal: negativo e saida, positivo e entrada; zero nao existe
    amount: Money
    external_id: str | None = Field(default=None, min_length=1, max_length=255)

    @field_validator("description")
    @classmethod
    def clean_description(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Descricao vazia")
        return value

    @field_validator("date")
    @classmethod
    def valid_date(cls, value: date) -> date:
        return check_import_date(value)

    @model_validator(mode="after")
    def amount_not_zero(self):
        if self.amount == Decimal(0):
            raise ValueError("O valor nao pode ser zero")
        return self


class ImportConfirm(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: uuid.UUID
    rows: list[ImportRowIn] = Field(min_length=1)

    @field_validator("rows")
    @classmethod
    def not_too_many(cls, rows: list[ImportRowIn]) -> list[ImportRowIn]:
        if len(rows) > settings.import_max_rows:
            raise ValueError(f"No maximo {settings.import_max_rows} linhas por importacao")
        return rows


class ImportResultOut(BaseModel):
    created: int
    # Linhas que o banco ja tinha importado antes (mesmo identificador) e foram deixadas de fora
    skipped: int
