"""Motor de regras: decide o que preencher num lancamento, sem tocar no banco.

A regra so preenche o que esta vazio. Categoria, orcamento e conta a pagar que a pessoa ja
escolheu nunca sao trocados, e entre duas regras vale a primeira que preencheu. Etiquetas so
se somam as que ja existem. Por ser uma funcao pura, o motor e testado em tabela.
"""

import enum
import unicodedata
import uuid
from dataclasses import dataclass, field
from decimal import Decimal


class MatchMode(enum.StrEnum):
    all = "all"
    any = "any"


class TriggerField(enum.StrEnum):
    description = "description"
    counterparty = "counterparty"
    amount = "amount"
    account = "account"
    type = "type"


class TriggerOp(enum.StrEnum):
    contains = "contains"
    starts_with = "starts_with"
    equals = "equals"
    greater_than = "greater_than"
    less_than = "less_than"
    is_ = "is"


class ActionKind(enum.StrEnum):
    set_category = "set_category"
    add_tag = "add_tag"
    set_budget = "set_budget"
    set_bill = "set_bill"


# Quais operacoes cada campo aceita
TEXT_OPS = frozenset({TriggerOp.contains, TriggerOp.starts_with, TriggerOp.equals})
AMOUNT_OPS = frozenset({TriggerOp.greater_than, TriggerOp.less_than, TriggerOp.equals})
VALID_OPS: dict[TriggerField, frozenset[TriggerOp]] = {
    TriggerField.description: TEXT_OPS,
    TriggerField.counterparty: TEXT_OPS,
    TriggerField.amount: AMOUNT_OPS,
    TriggerField.account: frozenset({TriggerOp.is_}),
    TriggerField.type: frozenset({TriggerOp.is_}),
}


@dataclass(frozen=True)
class SplitFacts:
    """O que se sabe do split no momento de aplicar as regras."""

    type: str
    description: str
    amount: Decimal
    account_id: uuid.UUID
    counterparty_name: str | None = None
    category_id: uuid.UUID | None = None
    budget_id: uuid.UUID | None = None
    bill_id: uuid.UUID | None = None
    tag_ids: tuple[uuid.UUID, ...] = ()


@dataclass(frozen=True)
class Trigger:
    field: TriggerField
    op: TriggerOp
    # Texto, Decimal (valor) ou UUID (conta), conforme o campo
    value: str | Decimal | uuid.UUID


@dataclass(frozen=True)
class Action:
    kind: ActionKind
    target_id: uuid.UUID


@dataclass(frozen=True)
class RuleDef:
    id: uuid.UUID
    match_mode: MatchMode
    triggers: tuple[Trigger, ...]
    actions: tuple[Action, ...]
    stop_processing: bool = False


@dataclass
class Fill:
    """O que as regras decidiram preencher. Campos None ou vazios ficam como estao."""

    category_id: uuid.UUID | None = None
    budget_id: uuid.UUID | None = None
    bill_id: uuid.UUID | None = None
    add_tag_ids: list[uuid.UUID] = field(default_factory=list)
    matched_rule_ids: list[uuid.UUID] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not (self.category_id or self.budget_id or self.bill_id or self.add_tag_ids)


def normalize_text(text: str) -> str:
    """Minusculo e sem acento: 'Padaria Pao' casa com 'padaria pão'."""
    decomposed = unicodedata.normalize("NFD", text.casefold())
    return "".join(char for char in decomposed if not unicodedata.combining(char)).strip()


def _text_matches(actual: str | None, op: TriggerOp, expected: str) -> bool:
    if actual is None:
        return False
    actual, expected = normalize_text(actual), normalize_text(str(expected))
    if op == TriggerOp.contains:
        return expected in actual
    if op == TriggerOp.starts_with:
        return actual.startswith(expected)
    return actual == expected


def _amount_matches(actual: Decimal, op: TriggerOp, expected: Decimal) -> bool:
    if op == TriggerOp.greater_than:
        return actual > expected
    if op == TriggerOp.less_than:
        return actual < expected
    return actual == expected


def trigger_matches(trigger: Trigger, facts: SplitFacts) -> bool:
    if trigger.op not in VALID_OPS[trigger.field]:
        return False
    if trigger.field == TriggerField.description:
        return _text_matches(facts.description, trigger.op, str(trigger.value))
    if trigger.field == TriggerField.counterparty:
        return _text_matches(facts.counterparty_name, trigger.op, str(trigger.value))
    if trigger.field == TriggerField.amount:
        return _amount_matches(facts.amount, trigger.op, Decimal(trigger.value))
    if trigger.field == TriggerField.account:
        return facts.account_id == trigger.value
    return facts.type == str(trigger.value)


def rule_matches(rule: RuleDef, facts: SplitFacts) -> bool:
    # Regra sem gatilho nao casa com nada: evita uma regra recem-criada mexer em tudo
    if not rule.triggers:
        return False
    results = (trigger_matches(trigger, facts) for trigger in rule.triggers)
    return all(results) if rule.match_mode == MatchMode.all else any(results)


def apply_rules(rules: list[RuleDef], facts: SplitFacts) -> Fill:
    """Percorre as regras na ordem recebida (o chamador ja ordenou) e junta o que preencher."""
    fill = Fill()
    known_tags = set(facts.tag_ids)
    for rule in rules:
        if not rule_matches(rule, facts):
            continue
        fill.matched_rule_ids.append(rule.id)
        for action in rule.actions:
            if action.kind == ActionKind.set_category:
                if facts.category_id is None and fill.category_id is None:
                    fill.category_id = action.target_id
            elif action.kind == ActionKind.set_budget:
                if facts.budget_id is None and fill.budget_id is None:
                    fill.budget_id = action.target_id
            elif action.kind == ActionKind.set_bill:
                if facts.bill_id is None and fill.bill_id is None:
                    fill.bill_id = action.target_id
            elif action.target_id not in known_tags:
                known_tags.add(action.target_id)
                fill.add_tag_ids.append(action.target_id)
        if rule.stop_processing:
            break
    return fill
