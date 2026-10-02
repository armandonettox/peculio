import uuid
from decimal import Decimal

import pytest

from app.services.rules_engine import (
    Action,
    ActionKind,
    MatchMode,
    RuleDef,
    SplitFacts,
    Trigger,
    TriggerField,
    TriggerOp,
    apply_rules,
    normalize_text,
    rule_matches,
    trigger_matches,
)

ACCOUNT = uuid.UUID(int=1)
OTHER_ACCOUNT = uuid.UUID(int=2)
CATEGORY = uuid.UUID(int=10)
CATEGORY_2 = uuid.UUID(int=11)
BUDGET = uuid.UUID(int=20)
BUDGET_2 = uuid.UUID(int=21)
BILL = uuid.UUID(int=30)
BILL_2 = uuid.UUID(int=31)
TAG = uuid.UUID(int=40)
TAG_2 = uuid.UUID(int=41)

# Acentos montados por codigo: o arquivo fica so em ASCII
A_TILDE = chr(0xE3)
C_CEDILLA_UPPER = chr(0xC7)
I_ACUTE_UPPER = chr(0xCD)
SHARP_S = chr(0xDF)
PAO_UPPER = "Padaria P" + A_TILDE + "o"
ACAI_UPPER = "  A" + C_CEDILLA_UPPER + "A" + I_ACUTE_UPPER + "  "
STRASSE = "stra" + SHARP_S + "e"


def facts(**overrides) -> SplitFacts:
    base = dict(
        type="withdrawal",
        description="Compra no Mercado Central",
        amount=Decimal("120.50"),
        account_id=ACCOUNT,
        counterparty_name="Supermercado Central",
    )
    return SplitFacts(**{**base, **overrides})


def trig(field, op, value) -> Trigger:
    return Trigger(TriggerField(field), TriggerOp(op), value)


def rule(triggers, actions, mode="all", stop=False, rule_id=None) -> RuleDef:
    return RuleDef(
        id=rule_id or uuid.uuid4(),
        match_mode=MatchMode(mode),
        triggers=tuple(triggers),
        actions=tuple(actions),
        stop_processing=stop,
    )


def act(kind, target) -> Action:
    return Action(ActionKind(kind), target)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (PAO_UPPER, "padaria pao"),
        (ACAI_UPPER, "acai"),
        (STRASSE, "strasse"),
        ("", ""),
    ],
)
def test_normalize_text(text, expected):
    assert normalize_text(text) == expected


@pytest.mark.parametrize(
    ("field", "op", "value", "overrides", "expected"),
    [
        # Texto: ignora maiuscula e acento
        ("description", "contains", "mercado", {}, True),
        ("description", "contains", "MERCADO", {}, True),
        ("description", "contains", "farmacia", {}, False),
        ("description", "contains", "pao", {"description": PAO_UPPER}, True),
        ("description", "starts_with", "compra", {}, True),
        ("description", "starts_with", "mercado", {}, False),
        ("description", "equals", "compra no mercado central", {}, True),
        ("description", "equals", "compra no mercado", {}, False),
        ("counterparty", "contains", "super", {}, True),
        ("counterparty", "starts_with", "central", {}, False),
        ("counterparty", "equals", "supermercado central", {}, True),
        # Sem contraparte nenhum texto casa
        ("counterparty", "contains", "super", {"counterparty_name": None}, False),
        ("counterparty", "equals", "", {"counterparty_name": None}, False),
        # Valor: fronteira exata nao entra em maior/menor
        ("amount", "greater_than", Decimal("120.49"), {}, True),
        ("amount", "greater_than", Decimal("120.50"), {}, False),
        ("amount", "less_than", Decimal("120.51"), {}, True),
        ("amount", "less_than", Decimal("120.50"), {}, False),
        ("amount", "equals", Decimal("120.50"), {}, True),
        ("amount", "equals", Decimal("120.5"), {}, True),
        ("amount", "equals", Decimal("120.51"), {}, False),
        # Conta e tipo
        ("account", "is", ACCOUNT, {}, True),
        ("account", "is", OTHER_ACCOUNT, {}, False),
        ("type", "is", "withdrawal", {}, True),
        ("type", "is", "deposit", {}, False),
        # Operacao que o campo nao aceita nunca casa
        ("amount", "contains", Decimal("1"), {}, False),
        ("description", "greater_than", "a", {}, False),
        ("account", "equals", ACCOUNT, {}, False),
    ],
)
def test_trigger_matches(field, op, value, overrides, expected):
    assert trigger_matches(trig(field, op, value), facts(**overrides)) is expected


def test_rule_without_triggers_never_matches():
    assert rule_matches(rule([], [act("set_category", CATEGORY)]), facts()) is False
    assert rule_matches(rule([], [act("set_category", CATEGORY)], mode="any"), facts()) is False


@pytest.mark.parametrize(
    ("mode", "first_ok", "second_ok", "expected"),
    [
        ("all", True, True, True),
        ("all", True, False, False),
        ("all", False, True, False),
        ("all", False, False, False),
        ("any", True, True, True),
        ("any", True, False, True),
        ("any", False, True, True),
        ("any", False, False, False),
    ],
)
def test_match_mode(mode, first_ok, second_ok, expected):
    triggers = [
        trig("description", "contains", "mercado" if first_ok else "farmacia"),
        trig("type", "is", "withdrawal" if second_ok else "deposit"),
    ]
    assert rule_matches(rule(triggers, [], mode=mode), facts()) is expected


MATCH = trig("description", "contains", "mercado")
MISS = trig("description", "contains", "farmacia")


def test_fills_empty_fields():
    fill = apply_rules(
        [
            rule(
                [MATCH],
                [act("set_category", CATEGORY), act("set_budget", BUDGET), act("set_bill", BILL), act("add_tag", TAG)],
            )
        ],
        facts(),
    )
    assert fill.category_id == CATEGORY
    assert fill.budget_id == BUDGET
    assert fill.bill_id == BILL
    assert fill.add_tag_ids == [TAG]
    assert not fill.is_empty


def test_never_overwrites_what_is_already_chosen():
    chosen = facts(category_id=CATEGORY_2, budget_id=BUDGET_2, bill_id=BILL)
    fill = apply_rules(
        [rule([MATCH], [act("set_category", CATEGORY), act("set_budget", BUDGET), act("set_bill", uuid.UUID(int=31))])],
        chosen,
    )
    assert fill.category_id is None
    assert fill.budget_id is None
    assert fill.bill_id is None
    assert fill.is_empty


def test_each_field_is_decided_on_its_own():
    # So a categoria foi escolhida: orcamento ainda e preenchido
    fill = apply_rules(
        [rule([MATCH], [act("set_category", CATEGORY), act("set_budget", BUDGET)])], facts(category_id=CATEGORY_2)
    )
    assert fill.category_id is None
    assert fill.budget_id == BUDGET


def test_first_rule_wins_for_single_value_fields():
    fill = apply_rules(
        [
            rule([MATCH], [act("set_category", CATEGORY), act("set_budget", BUDGET), act("set_bill", BILL)]),
            rule(
                [MATCH],
                [act("set_category", CATEGORY_2), act("set_budget", BUDGET_2), act("set_bill", BILL_2)],
            ),
        ],
        facts(),
    )
    assert fill.category_id == CATEGORY
    assert fill.budget_id == BUDGET
    assert fill.bill_id == BILL


def test_later_rule_fills_what_the_first_left_empty():
    fill = apply_rules(
        [
            rule([MATCH], [act("set_category", CATEGORY)]),
            rule([MATCH], [act("set_category", CATEGORY_2), act("set_budget", BUDGET)]),
        ],
        facts(),
    )
    assert fill.category_id == CATEGORY
    assert fill.budget_id == BUDGET


def test_tags_are_added_without_duplicates_and_keep_existing():
    fill = apply_rules(
        [
            rule([MATCH], [act("add_tag", TAG), act("add_tag", TAG_2)]),
            rule([MATCH], [act("add_tag", TAG), act("add_tag", TAG_2)]),
        ],
        facts(tag_ids=(TAG,)),
    )
    # TAG ja estava no lancamento: nao entra de novo; TAG_2 entra uma vez so
    assert fill.add_tag_ids == [TAG_2]


def test_stop_processing_ends_after_the_matching_rule():
    first = rule([MATCH], [act("set_category", CATEGORY)], stop=True)
    second = rule([MATCH], [act("set_budget", BUDGET)])
    fill = apply_rules([first, second], facts())
    assert fill.category_id == CATEGORY
    assert fill.budget_id is None
    assert fill.matched_rule_ids == [first.id]


def test_stop_processing_applies_even_when_nothing_was_filled():
    # A regra casou, so que a categoria ja estava escolhida: mesmo assim ela encerra a lista
    first = rule([MATCH], [act("set_category", CATEGORY)], stop=True)
    second = rule([MATCH], [act("set_budget", BUDGET)])
    fill = apply_rules([first, second], facts(category_id=CATEGORY_2))
    assert fill.budget_id is None
    assert fill.matched_rule_ids == [first.id]


def test_stop_processing_is_ignored_when_the_rule_does_not_match():
    first = rule([MISS], [act("set_category", CATEGORY)], stop=True)
    second = rule([MATCH], [act("set_budget", BUDGET)])
    fill = apply_rules([first, second], facts())
    assert fill.budget_id == BUDGET
    assert fill.matched_rule_ids == [second.id]


def test_no_rules_and_no_match_fill_nothing():
    assert apply_rules([], facts()).is_empty
    assert apply_rules([rule([MISS], [act("set_category", CATEGORY)])], facts()).is_empty


def test_rules_do_not_see_what_earlier_rules_filled():
    # Os gatilhos olham o lancamento original: a categoria que a regra 1 preencheu nao muda a 2
    fill = apply_rules(
        [
            rule([MATCH], [act("set_category", CATEGORY)]),
            rule([MATCH], [act("set_budget", BUDGET)]),
        ],
        facts(),
    )
    assert (fill.category_id, fill.budget_id) == (CATEGORY, BUDGET)
