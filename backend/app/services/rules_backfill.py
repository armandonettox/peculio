"""Aplica as regras sobre lancamentos que ja existem, com previa.

A previa e a aplicacao percorrem o mesmo caminho: so muda se grava ou nao. Vale a mesma regra
de sempre, so preenche o que esta vazio. Um lancamento antigo que a pessoa deixou sem conta a
pagar de proposito nao se distingue de um que nunca teve, entao a regra pode ligar a conta.
"""

import uuid
from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models.account import Account
from app.models.transaction import Transaction, TransactionSplit, TransactionType, transaction_split_tags
from app.models.user import User
from app.schemas.transaction import TransactionSplitCreate
from app.services.accounts import get_owned_account
from app.services.rule_defs import load_rule_defs
from app.services.rules_engine import SplitFacts, apply_rules
from app.services.transactions import LISTED_TYPES, notify_transaction_updated, vet_rule_fill

# Acima disso a pessoa precisa estreitar o periodo ou a conta: tudo roda numa so requisicao
MAX_SCANNED = 20000
# A previa mostra os primeiros itens; o total de mudancas vem sempre completo
PREVIEW_ITEMS = 200
TAG_CHUNK = 1000


def _splits_statement(user_id: uuid.UUID, date_from: date | None, date_to: date | None, account_id: uuid.UUID | None):
    statement = select(TransactionSplit).where(
        TransactionSplit.user_id == user_id, TransactionSplit.type.in_(LISTED_TYPES)
    )
    if date_from is not None:
        statement = statement.where(TransactionSplit.date >= date_from)
    if date_to is not None:
        statement = statement.where(TransactionSplit.date <= date_to)
    if account_id is not None:
        statement = statement.where(
            or_(TransactionSplit.source_account_id == account_id, TransactionSplit.destination_account_id == account_id)
        )
    return statement


def _selected_rules(db: Session, user_id: uuid.UUID, rule_ids: list[uuid.UUID] | None):
    defs = load_rule_defs(db, user_id, rule_ids)
    if rule_ids is not None and {rule.id for rule in defs} != set(rule_ids):
        raise AppError(422, ErrorCode.RULE_INVALID, "Escolha apenas regras ativas")
    return defs


def _tags_by_split(db: Session, split_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
    tags: dict[uuid.UUID, list[uuid.UUID]] = {split_id: [] for split_id in split_ids}
    for start in range(0, len(split_ids), TAG_CHUNK):
        chunk = split_ids[start : start + TAG_CHUNK]
        rows = db.execute(
            select(transaction_split_tags.c.transaction_split_id, transaction_split_tags.c.tag_id).where(
                transaction_split_tags.c.transaction_split_id.in_(chunk)
            )
        )
        for split_id, tag_id in rows:
            tags[split_id].append(tag_id)
    return tags


def run_rules(
    db: Session,
    user: User,
    *,
    date_from: date | None,
    date_to: date | None,
    account_id: uuid.UUID | None,
    rule_ids: list[uuid.UUID] | None,
    apply: bool,
) -> dict:
    if account_id is not None:
        get_owned_account(db, user.id, account_id)
    defs = _selected_rules(db, user.id, rule_ids)

    statement = _splits_statement(user.id, date_from, date_to, account_id)
    scanned = db.scalar(select(func.count()).select_from(statement.subquery()))
    if scanned > MAX_SCANNED:
        raise AppError(
            422, ErrorCode.RULE_RUN_TOO_LARGE, "Lancamentos demais de uma vez. Escolha um periodo ou uma conta."
        )
    result: dict = {"scanned": scanned, "changed": 0, "items": [], "truncated": False}
    if not defs or scanned == 0:
        return result

    splits = list(db.scalars(statement.order_by(TransactionSplit.date, TransactionSplit.id)))
    tags = _tags_by_split(db, [split.id for split in splits])
    accounts = {account.id: account for account in db.scalars(select(Account).where(Account.user_id == user.id))}

    touched: set[uuid.UUID] = set()
    for split in splits:
        outgoing = split.type != TransactionType.deposit
        own_id = split.source_account_id if outgoing else split.destination_account_id
        other = accounts.get(split.destination_account_id if outgoing else split.source_account_id)
        existing_tags = tags[split.id]
        fill = apply_rules(
            defs,
            SplitFacts(
                type=split.type.value,
                description=split.description,
                amount=split.amount,
                account_id=own_id,
                counterparty_name=other.name if other else None,
                category_id=split.category_id,
                budget_id=split.budget_id,
                bill_id=split.bill_id,
                tag_ids=tuple(existing_tags),
            ),
        )
        if fill.is_empty:
            continue
        # bill_id fica de fora quando vazio: assim conta como "nao informado", nao como null explicito
        fields = dict(
            type=split.type,
            date=split.date,
            description=split.description,
            amount=split.amount,
            currency_code=split.currency_code,
            account_id=own_id,
            category_id=split.category_id,
            budget_id=split.budget_id,
            tag_ids=list(existing_tags),
        )
        if split.bill_id is not None:
            fields["bill_id"] = split.bill_id
        data = TransactionSplitCreate.model_construct(**fields)
        changes = vet_rule_fill(db, user, data, split.destination_account_id, fill)
        new_tags = [tag_id for tag_id in changes.get("tag_ids", []) if tag_id not in existing_tags]
        wanted = {key: changes[key] for key in ("category_id", "budget_id", "bill_id") if key in changes}
        if not wanted and not new_tags:
            continue

        result["changed"] += 1
        if len(result["items"]) < PREVIEW_ITEMS:
            result["items"].append(
                {
                    "transaction_id": split.transaction_id,
                    "split_id": split.id,
                    "date": split.date,
                    "description": split.description,
                    "amount": split.amount,
                    "currency_code": split.currency_code,
                    "category_id": wanted.get("category_id"),
                    "budget_id": wanted.get("budget_id"),
                    "bill_id": wanted.get("bill_id"),
                    "add_tag_ids": new_tags,
                    "rule_ids": fill.matched_rule_ids,
                }
            )
        else:
            result["truncated"] = True
        if apply:
            for key, value in wanted.items():
                setattr(split, key, value)
            if new_tags:
                db.execute(
                    transaction_split_tags.insert(),
                    [{"transaction_split_id": split.id, "tag_id": tag_id} for tag_id in new_tags],
                )
            touched.add(split.transaction_id)

    if apply and touched:
        db.flush()
        for transaction_id in sorted(touched):
            notify_transaction_updated(db, user.id, db.get(Transaction, transaction_id))
    return result
