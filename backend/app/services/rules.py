import uuid
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.core.pagination import PageParams, paginate
from app.models.rule import Rule, RuleGroup
from app.models.user import User
from app.schemas.rule import (
    ActionIn,
    RuleCreate,
    RuleGroupCreate,
    RuleGroupUpdate,
    RuleUpdate,
    TriggerIn,
)
from app.services.accounts import get_owned_account
from app.services.bills import get_owned_bill
from app.services.budgets import get_owned_budget
from app.services.rules_engine import Action, ActionKind, RuleDef, Trigger, TriggerField
from app.services.transactions import get_owned_category, get_owned_tags


def _rule_order():
    """Ordem de execucao: grupos pela posicao, regras pela posicao dentro do grupo; as regras
    sem grupo vem depois de todos os grupos. Empates se resolvem por criacao e id."""
    return (
        RuleGroup.position.asc().nulls_last(),
        RuleGroup.id.asc().nulls_last(),
        Rule.position.asc(),
        Rule.created_at.asc(),
        Rule.id.asc(),
    )


# ---------- Grupos ----------


def get_owned_group(db: Session, user_id: uuid.UUID, group_id: uuid.UUID) -> RuleGroup:
    group = db.execute(
        select(RuleGroup).where(RuleGroup.id == group_id, RuleGroup.user_id == user_id)
    ).scalar_one_or_none()
    if not group:
        raise AppError(404, ErrorCode.RULE_GROUP_NOT_FOUND, "Grupo de regras nao encontrado")
    return group


def _save_group(db: Session, group: RuleGroup) -> None:
    try:
        with db.begin_nested():
            db.add(group)
            db.flush()
    except IntegrityError:
        raise AppError(409, ErrorCode.RULE_GROUP_NAME_TAKEN, "Ja existe um grupo com esse nome")


def create_group(db: Session, user: User, data: RuleGroupCreate) -> RuleGroup:
    group = RuleGroup(user_id=user.id, name=data.name, position=data.position)
    _save_group(db, group)
    return group


def update_group(db: Session, group: RuleGroup, data: RuleGroupUpdate) -> RuleGroup:
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(group, field, value)
    _save_group(db, group)
    return group


def list_groups(db: Session, user_id: uuid.UUID) -> list[RuleGroup]:
    statement = select(RuleGroup).where(RuleGroup.user_id == user_id)
    return list(db.execute(statement.order_by(RuleGroup.position, func.lower(RuleGroup.name), RuleGroup.id)).scalars())


def delete_group(db: Session, group: RuleGroup) -> None:
    # As regras do grupo ficam, sem grupo (o banco faz o SET NULL)
    db.delete(group)
    db.flush()


# ---------- Regras ----------


def get_owned_rule(db: Session, user_id: uuid.UUID, rule_id: uuid.UUID) -> Rule:
    rule = db.execute(select(Rule).where(Rule.id == rule_id, Rule.user_id == user_id)).scalar_one_or_none()
    if not rule:
        raise AppError(404, ErrorCode.RULE_NOT_FOUND, "Regra nao encontrada")
    return rule


def _invalid(message: str) -> AppError:
    return AppError(422, ErrorCode.RULE_INVALID, message)


def _check_targets(db: Session, user_id: uuid.UUID, triggers: list[TriggerIn], actions: list[ActionIn]) -> None:
    """Contas, categorias, etiquetas, orcamentos e contas a pagar citados precisam ser do usuario."""
    try:
        for trigger in triggers:
            if trigger.field == TriggerField.account:
                get_owned_account(db, user_id, uuid.UUID(trigger.value))
        for action in actions:
            if action.kind == ActionKind.set_category:
                get_owned_category(db, user_id, action.target_id)
            elif action.kind == ActionKind.set_budget:
                get_owned_budget(db, user_id, action.target_id)
            elif action.kind == ActionKind.set_bill:
                get_owned_bill(db, user_id, action.target_id)
        get_owned_tags(db, user_id, [a.target_id for a in actions if a.kind == ActionKind.add_tag])
    except AppError as error:
        if error.status_code != 404:
            raise
        raise _invalid("A regra cita algo que nao existe") from None


def _save(db: Session, rule: Rule) -> None:
    try:
        with db.begin_nested():
            db.add(rule)
            db.flush()
    except IntegrityError:
        raise AppError(409, ErrorCode.RULE_NAME_TAKEN, "Ja existe uma regra com esse nome")


def _dump_triggers(triggers: list[TriggerIn]) -> list[dict]:
    return [trigger.model_dump(mode="json") for trigger in triggers]


def _dump_actions(actions: list[ActionIn]) -> list[dict]:
    return [action.model_dump(mode="json") for action in actions]


def create_rule(db: Session, user: User, data: RuleCreate) -> Rule:
    if data.group_id is not None:
        get_owned_group(db, user.id, data.group_id)
    _check_targets(db, user.id, data.triggers, data.actions)
    rule = Rule(
        user_id=user.id,
        group_id=data.group_id,
        name=data.name,
        position=data.position,
        match_mode=data.match_mode,
        stop_processing=data.stop_processing,
        active=data.active,
        triggers=_dump_triggers(data.triggers),
        actions=_dump_actions(data.actions),
    )
    _save(db, rule)
    return rule


def update_rule(db: Session, rule: Rule, data: RuleUpdate) -> Rule:
    sent = data.model_dump(exclude_unset=True)
    if "group_id" in sent:
        if data.group_id is not None:
            get_owned_group(db, rule.user_id, data.group_id)
        rule.group_id = data.group_id
    for field in ("name", "position", "match_mode", "stop_processing", "active"):
        if sent.get(field) is not None:
            setattr(rule, field, sent[field])
    if data.triggers is not None or data.actions is not None:
        triggers = data.triggers if data.triggers is not None else [TriggerIn(**t) for t in rule.triggers]
        actions = data.actions if data.actions is not None else [ActionIn(**a) for a in rule.actions]
        _check_targets(db, rule.user_id, triggers, actions)
        rule.triggers = _dump_triggers(triggers)
        rule.actions = _dump_actions(actions)
    _save(db, rule)
    return rule


def list_rules(db: Session, user_id: uuid.UUID, params: PageParams, q: str | None, active: bool | None) -> dict:
    statement = select(Rule).outerjoin(RuleGroup, Rule.group_id == RuleGroup.id).where(Rule.user_id == user_id)
    if active is not None:
        statement = statement.where(Rule.active == active)
    if q and q.strip():
        statement = statement.where(func.lower(Rule.name).contains(q.strip().lower(), autoescape=True))
    return paginate(db, statement.order_by(*_rule_order()), params)


def delete_rule(db: Session, rule: Rule) -> None:
    db.delete(rule)
    db.flush()


# ---------- Para o motor ----------


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
        .order_by(*_rule_order())
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
