import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.recurrence import RecurrenceFrequency
from app.models.transaction import TransactionType
from app.schemas.transaction import TransactionCreate

Money = Annotated[Decimal, Field(max_digits=18, decimal_places=2)]
PositiveMoney = Annotated[Decimal, Field(max_digits=18, decimal_places=2, gt=0)]
# So faz sentido lembrar de uma saida ou de uma entrada; transferencia nao tem "a pagar"
BillType = Literal[TransactionType.withdrawal, TransactionType.deposit]


def _strip_name(value: str | None) -> str | None:
    if value is None:
        return value
    value = value.strip()
    if not value:
        raise ValueError("Informe o nome")
    return value


def _strip_match(value: str | None) -> str | None:
    # Texto em branco vale como "sem ligacao automatica"
    if value is None:
        return None
    return value.strip() or None


class RecurrenceCreate(BaseModel):
    """`auto_create` liga ou desliga o modo. Ligado, pede `template` (um lancamento comum, cuja
    data de cada linha e trocada pela data de cada ocorrencia) e o tipo vem dele. Desligado, pede
    `type` (saida ou entrada), `currency_code` e a faixa de valor (`amount_min`/`amount_max`) para
    so lembrar o vencimento."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    frequency: RecurrenceFrequency
    first_date: date
    end_date: date | None = None
    max_occurrences: int | None = Field(default=None, ge=1, le=100000)
    auto_create: bool = False
    template: TransactionCreate | None = None
    type: BillType | None = None
    currency_code: str | None = Field(default=None, min_length=3, max_length=3)
    amount_min: PositiveMoney | None = None
    amount_max: PositiveMoney | None = None
    match_text: str | None = Field(default=None, max_length=100)

    _strip_name = field_validator("name")(_strip_name)
    _strip_match = field_validator("match_text")(_strip_match)

    @field_validator("currency_code")
    @classmethod
    def upper_currency(cls, value: str | None) -> str | None:
        return value.strip().upper() if value else value

    @model_validator(mode="after")
    def check_mode(self):
        if self.end_date is not None and self.max_occurrences is not None:
            raise ValueError("Informe so a data final ou so o numero de repeticoes")
        if self.end_date is not None and self.end_date < self.first_date:
            raise ValueError("A data final nao pode ser antes da primeira")
        if self.auto_create:
            if self.template is None:
                raise ValueError("Informe o modelo do lancamento")
            if self.type is not None:
                raise ValueError("O tipo vem do modelo do lancamento, nao se informa a parte")
        else:
            if self.currency_code is None or self.amount_min is None or self.amount_max is None:
                raise ValueError("Informe a moeda e a faixa de valor")
            if self.amount_max < self.amount_min:
                raise ValueError("O valor maximo nao pode ser menor que o minimo")
            if self.type is None:
                raise ValueError("Informe se o lembrete e de saida ou de entrada")
        return self


class RecurrenceUpdate(BaseModel):
    """`auto_create` nao muda depois de criada: define o que a recorrente precisa. No modo
    automatico, a frequencia e a primeira data tambem nao mudam: elas definem todas as datas que
    ja foram geradas. No modo de lembrete, as duas podem ser corrigidas (nada foi gerado a partir
    delas), mas o `type` (saida ou entrada) nao muda, como a moeda: trocaria o sentido dos
    lancamentos ja ligados. `end_date` e `max_occurrences` enviados como null tiram o fim.
    `match_text` enviado como null apaga a ligacao automatica."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    active: bool | None = None
    frequency: RecurrenceFrequency | None = None
    first_date: date | None = None
    end_date: date | None = None
    max_occurrences: int | None = Field(default=None, ge=1, le=100000)
    template: TransactionCreate | None = None
    amount_min: PositiveMoney | None = None
    amount_max: PositiveMoney | None = None
    match_text: str | None = Field(default=None, max_length=100)

    _strip_name = field_validator("name")(_strip_name)
    _strip_match = field_validator("match_text")(_strip_match)


class RecurrenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    frequency: RecurrenceFrequency
    first_date: date
    end_date: date | None
    max_occurrences: int | None
    active: bool
    auto_create: bool
    template: TransactionCreate | None
    type: BillType | None
    currency_code: str | None
    amount_min: Money | None
    amount_max: Money | None
    match_text: str | None
    # Quantos lancamentos ja foram criados (so no modo automatico)
    created_count: int
    # Data do proximo; vazia quando a recorrente terminou (so no modo automatico)
    next_date: date | None
    ended: bool
    last_error: str | None
    created_at: datetime


RecurrenceStatus = Literal["upcoming", "paid", "overdue"]


class RecurrenceStatusOut(RecurrenceOut):
    """Uma recorrente do modo de lembrete, com a situacao na data pedida."""

    # Ultimo vencimento ate a data (inclusive); vazio se o primeiro ainda nao chegou
    last_due_date: date | None
    # Primeiro vencimento depois da data
    next_due_date: date
    # upcoming: o primeiro vencimento ainda nao chegou; paid: o ultimo foi pago; overdue: nao foi
    status: RecurrenceStatus
    # Vencimentos seguidos sem pagar ate o ultimo (0 se nao esta atrasada) e a data do mais antigo deles
    overdue_count: int
    oldest_overdue_date: date | None
    # O proximo vencimento ja foi pago adiantado
    next_due_paid: bool


class RunResult(BaseModel):
    created: int
