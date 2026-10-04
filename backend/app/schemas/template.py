import datetime as dt
import uuid
from typing import Annotated, Literal

from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.budget import TemplateKind
from app.schemas.envelope import Money, parse_month

PositiveMoney = Annotated[Decimal, Field(max_digits=18, decimal_places=2, gt=0)]

GoalState = Literal["met", "partial", "short"]
# Por que um envelope ficou de fora da aplicacao
SkipReason = Literal["already_has", "goal_met", "date_passed", "no_due_date", "no_money_left"]


class TemplateIn(BaseModel):
    """O template de um envelope. Cada tipo usa so os campos dele; o resto precisa ficar vazio."""

    model_config = ConfigDict(extra="forbid")

    kind: TemplateKind
    # fixed: valor por mes. by_date: a meta.
    amount: PositiveMoney | None = None
    # by_date: o mes em que a meta precisa estar pronta ("AAAA-MM")
    target_month: str | None = None
    # bill: a conta a pagar
    bill_id: uuid.UUID | None = None

    @field_validator("target_month")
    @classmethod
    def valid_month(cls, value: str | None) -> str | None:
        if value is not None:
            parse_month(value)
        return value

    @model_validator(mode="after")
    def check_kind(self):
        needs_amount = self.kind in (TemplateKind.fixed, TemplateKind.by_date)
        if needs_amount and self.amount is None:
            raise ValueError("Informe o valor")
        if not needs_amount and self.amount is not None:
            raise ValueError("Este tipo de template nao tem valor")
        if self.kind == TemplateKind.by_date and self.target_month is None:
            raise ValueError("Informe o mes da meta")
        if self.kind != TemplateKind.by_date and self.target_month is not None:
            raise ValueError("So o template de meta por data tem mes")
        if self.kind == TemplateKind.bill and self.bill_id is None:
            raise ValueError("Escolha a conta a pagar")
        if self.kind != TemplateKind.bill and self.bill_id is not None:
            raise ValueError("So o template de conta a pagar tem conta")
        return self


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kind: TemplateKind
    amount: Money | None
    # Primeiro dia do mes da meta
    target_month: dt.date | None
    bill_id: uuid.UUID | None


class TemplateApply(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: str
    # false: preenche so os envelopes sem valor. true: troca tambem o que ja tem valor.
    overwrite: bool = False

    @field_validator("month")
    @classmethod
    def valid_month(cls, value: str) -> str:
        parse_month(value)
        return value


class PreviewRowOut(BaseModel):
    budget_id: uuid.UUID
    name: str
    kind: TemplateKind
    # O que ja esta distribuido neste mes
    current: Money
    # O que o template pede
    wanted: Money
    # O que vai ficar distribuido se aplicar (igual a `current` quando o envelope fica de fora)
    proposed: Money
    applies: bool
    reason: SkipReason | None


class PreviewGroupOut(BaseModel):
    currency_code: str
    to_budget_before: Money
    # Negativo quando os templates somam mais do que o dinheiro disponivel
    to_budget_after: Money
    rows: list[PreviewRowOut]


class TemplatePreviewOut(BaseModel):
    month: dt.date
    overwrite: bool
    groups: list[PreviewGroupOut]


# ---------- O mes dos envelopes, com o template e o selo de meta de cada um ----------

from app.schemas.envelope import EnvelopeGroupOut, EnvelopeMonthOut, EnvelopeOut  # noqa: E402


class EnvelopeFullOut(EnvelopeOut):
    template: TemplateOut | None = None
    # So existe com template. None tambem quando o template nao pede nada neste mes.
    goal: GoalState | None = None


class EnvelopeGroupFullOut(EnvelopeGroupOut):
    envelopes: list[EnvelopeFullOut]


class EnvelopeMonthFullOut(EnvelopeMonthOut):
    groups: list[EnvelopeGroupFullOut]
