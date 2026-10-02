"""Carrega as regras do usuario para o motor. Fica separado do cadastro (rules.py) porque o
servico de transacoes precisa dele, e o cadastro importa o de transacoes."""

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.rule import Rule, RuleGroup
from app.schemas.rule import TriggerIn
from app.services.rules_engine import Action, ActionKind, RuleDef, Trigger, TriggerField


def rule_order():
    """Ordem de execucao: grupos pela posicao, regras pela posicao dentro do grupo; as regras
    sem grupo vem depois de todos os grupos. Empates se resolvem por criacao e id."""
    return (
        RuleGroup.position.asc().nulls_last(),
        RuleGroup.id.asc().nulls_last(),
        Rule.position.asc(),
        Rule.created_at.asc(),
        Rule.id.asc(),
    )


def _to_trigger(raw: dict) -> Trigger:
    trigger = TriggerIn(**raw)
    value: str | Decimal | uuid.UUID = trigger.value
    if trigger.field == TriggerField.amount:
        value = Decimal(trigger.value)
    elif trigger.field == TriggerField.account:
        value = uuid.UUID(trigger.value)
    return Trigger(trigger.field, trigger.op, value)


def load_rule_defs(db: Session, user_id: uuid.UUID) -> list[RuleDef]:
    """Regras ativas do usuario, ja na ordem de execucao."""
    statement = (
        select(Rule)
        .outerjoin(RuleGroup, Rule.group_id == RuleGroup.id)
        .where(Rule.user_id == user_id, Rule.active.is_(True))
        .order_by(*rule_order())
    )
    return [
        RuleDef(
            id=rule.id,
            match_mode=rule.match_mode,
            triggers=tuple(_to_trigger(raw) for raw in rule.triggers),
            actions=tuple(Action(ActionKind(raw["kind"]), uuid.UUID(raw["target_id"])) for raw in rule.actions),
            stop_processing=rule.stop_processing,
        )
        for rule in db.execute(statement).scalars()
    ]
