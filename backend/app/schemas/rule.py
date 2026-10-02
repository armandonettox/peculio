import uuid
from datetime import datetime
from decimal import Decimal, InvalidOperation

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.rules_engine import VALID_OPS, ActionKind, MatchMode, TriggerField, TriggerOp

MAX_ITEMS = 10
TRANSACTION_TYPES = {"withdrawal", "deposit", "transfer"}
# Acoes que aceitam um alvo so por regra; etiquetas podem ser varias
SINGLE_ACTIONS = {ActionKind.set_category, ActionKind.set_budget, ActionKind.set_bill}


def _strip_name(value: str | None) -> str | None:
    if value is None:
        return value
    value = value.strip()
    if not value:
        raise ValueError("Informe o nome")
    return value


class TriggerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: TriggerField
    op: TriggerOp
    # Sempre texto no JSON: valor em dinheiro como "120.50", conta como UUID
    value: str = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def check_value(self):
        if self.op not in VALID_OPS[self.field]:
            raise ValueError("Operacao nao vale para esse campo")
        value = self.value.strip()
        if self.field in (TriggerField.description, TriggerField.counterparty):
            if not value:
                raise ValueError("Informe o texto")
        elif self.field == TriggerField.amount:
            try:
                amount = Decimal(value)
            except InvalidOperation:
                raise ValueError("Valor invalido") from None
            if not amount.is_finite() or amount < 0 or amount != amount.quantize(Decimal("0.01")):
                raise ValueError("Valor deve ser positivo e ter ate 2 casas")
            if amount >= Decimal(10) ** 16:
                raise ValueError("Valor grande demais")
            value = format(amount.quantize(Decimal("0.01")), "f")
        elif self.field == TriggerField.account:
            try:
                value = str(uuid.UUID(value))
            except ValueError:
                raise ValueError("Conta invalida") from None
        elif value not in TRANSACTION_TYPES:
            raise ValueError("Tipo invalido")
        self.value = value
        return self


class ActionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: ActionKind
    target_id: uuid.UUID


class RuleBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    group_id: uuid.UUID | None = None
    position: int = Field(default=0, ge=0, le=100000)
    match_mode: MatchMode = MatchMode.all
    stop_processing: bool = False
    active: bool = True


def _check_actions(actions: list[ActionIn]) -> None:
    singles = [action.kind for action in actions if action.kind in SINGLE_ACTIONS]
    if len(singles) != len(set(singles)):
        raise ValueError("Cada regra define no maximo uma categoria, um orcamento e uma conta a pagar")
    tags = [action.target_id for action in actions if action.kind == ActionKind.add_tag]
    if len(tags) != len(set(tags)):
        raise ValueError("Etiqueta repetida")


class RuleCreate(RuleBase):
    name: str = Field(min_length=1, max_length=100)
    triggers: list[TriggerIn] = Field(min_length=1, max_length=MAX_ITEMS)
    actions: list[ActionIn] = Field(min_length=1, max_length=MAX_ITEMS)

    _strip_name = field_validator("name")(_strip_name)

    @field_validator("actions")
    @classmethod
    def unique_actions(cls, actions: list[ActionIn]) -> list[ActionIn]:
        _check_actions(actions)
        return actions


class RuleUpdate(BaseModel):
    """group_id enviado como null tira a regra do grupo; os demais campos nao aceitam null."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    group_id: uuid.UUID | None = None
    position: int | None = Field(default=None, ge=0, le=100000)
    match_mode: MatchMode | None = None
    stop_processing: bool | None = None
    active: bool | None = None
    triggers: list[TriggerIn] | None = Field(default=None, min_length=1, max_length=MAX_ITEMS)
    actions: list[ActionIn] | None = Field(default=None, min_length=1, max_length=MAX_ITEMS)

    _strip_name = field_validator("name")(_strip_name)

    @field_validator("actions")
    @classmethod
    def unique_actions(cls, actions: list[ActionIn] | None) -> list[ActionIn] | None:
        if actions is not None:
            _check_actions(actions)
        return actions


class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    group_id: uuid.UUID | None
    name: str
    position: int
    match_mode: MatchMode
    stop_processing: bool
    active: bool
    triggers: list[TriggerIn]
    actions: list[ActionIn]
    created_at: datetime


class RuleGroupCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    position: int = Field(default=0, ge=0, le=100000)

    _strip_name = field_validator("name")(_strip_name)


class RuleGroupUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    position: int | None = Field(default=None, ge=0, le=100000)

    _strip_name = field_validator("name")(_strip_name)


class RuleGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    position: int
    created_at: datetime
