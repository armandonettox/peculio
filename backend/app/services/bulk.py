"""Acoes em massa sobre lancamentos: mudar categoria, mudar data, duplicar e excluir. Tudo ou nada: roda na transacao
do pedido, e qualquer recusa (lancamento de outra pessoa, travado por conciliacao, categoria que nao existe) desfaz o
conjunto."""

import datetime as dt
import uuid
from collections.abc import Sequence
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core import clock
from app.core.errors import AppError, ErrorCode
from app.models.reconciliation import AccountClearing
from app.models.transaction import Transaction, TransactionSplit
from app.models.user import User
from app.schemas.bulk import BulkAction, BulkIn
from app.schemas.transaction import TransactionCreate, TransactionSplitCreate
from app.services import transactions as service
from app.services.transactions import LISTED_TYPES, tag_ids_by_split


def _load(db: Session, user_id: uuid.UUID, ids: Sequence[uuid.UUID]) -> list[Transaction]:
    """Os lancamentos pedidos, na ordem do pedido. Um que nao existe, e de outra pessoa ou e do sistema (saldo
    inicial) conta como nao encontrado, e o conjunto todo e recusado."""
    found = {
        transaction.id: transaction
        for transaction in db.execute(
            select(Transaction)
            .where(
                Transaction.id.in_(ids),
                Transaction.user_id == user_id,
                Transaction.id.in_(select(TransactionSplit.transaction_id).where(TransactionSplit.type.in_(LISTED_TYPES))),
            )
        ).scalars()
    }
    if len(found) != len(ids):
        raise AppError(404, ErrorCode.TRANSACTION_NOT_FOUND, "Um dos lancamentos nao foi encontrado")
    return [found[transaction_id] for transaction_id in ids]


def _locked_ids(db: Session, ids: Sequence[uuid.UUID]) -> list[uuid.UUID]:
    """Dos pedidos, os que tem algum lado travado por uma conciliacao fechada, na ordem do pedido."""
    locked = set(
        db.execute(
            select(TransactionSplit.transaction_id)
            .join(AccountClearing, AccountClearing.split_id == TransactionSplit.id)
            .where(TransactionSplit.transaction_id.in_(ids), AccountClearing.reconciliation_id.is_not(None))
        ).scalars()
    )
    return [transaction_id for transaction_id in ids if transaction_id in locked]


def _as_create(db: Session, transaction: Transaction, on: dt.date) -> TransactionCreate:
    """O corpo que criaria uma copia do lancamento, com a data dada. Leva descricao, contrapartes, valores, categoria,
    orcamento, tags e notas; nao leva anexos, marca de conferido, identificador do banco nem a conta a pagar."""
    splits = list(
        db.execute(
            select(TransactionSplit).where(TransactionSplit.transaction_id == transaction.id).order_by(TransactionSplit.position)
        ).scalars()
    )
    tags = tag_ids_by_split(db, [split.id for split in splits])
    created: list[TransactionSplitCreate] = []
    for split in splits:
        # A conta do usuario e a de onde sai (saque e transferencia) ou a que recebe (deposito)
        own_is_source = split.type.value != "deposit"
        own_id = split.source_account_id if own_is_source else split.destination_account_id
        other_id = split.destination_account_id if own_is_source else split.source_account_id
        created.append(
            TransactionSplitCreate(
                type=split.type.value,
                date=on,
                description=split.description,
                amount=split.amount,
                currency_code=split.currency_code,
                foreign_amount=split.foreign_amount,
                foreign_currency_code=split.foreign_currency_code,
                category_id=split.category_id,
                budget_id=split.budget_id,
                # Explicito: a copia nao paga de novo a mesma conta a pagar nem liga outra sozinha
                bill_id=None,
                tag_ids=tags.get(split.id, []),
                notes=split.notes,
                account_id=own_id,
                counterparty_account_id=other_id,
            )
        )
    return TransactionCreate(title=transaction.title, splits=created)


def apply_bulk(db: Session, user: User, data: BulkIn) -> tuple[dict, list[Path]]:
    """Aplica a acao. Devolve o resultado e os arquivos de anexos a apagar do disco depois do commit (so ao excluir)."""
    transactions = _load(db, user.id, data.ids)

    # Duplicar nao mexe nos originais, entao um travado nao atrapalha; as outras acoes mexem
    if data.action != BulkAction.duplicate:
        locked = _locked_ids(db, data.ids)
        if locked:
            raise AppError(
                409,
                ErrorCode.TRANSACTIONS_LOCKED,
                "Alguns lancamentos estao travados por uma conciliacao fechada. Nada foi alterado.",
                extra={"locked_ids": [str(transaction_id) for transaction_id in locked]},
            )

    paths: list[Path] = []
    created_ids: list[uuid.UUID] = []

    if data.action == BulkAction.set_category:
        if data.category_id is not None:
            service.get_owned_category(db, user.id, data.category_id)
        db.execute(
            update(TransactionSplit).where(TransactionSplit.transaction_id.in_(data.ids)).values(category_id=data.category_id)
        )
        db.flush()
        for transaction in transactions:
            service.notify_transaction_updated(db, user.id, transaction)

    elif data.action == BulkAction.set_date:
        db.execute(update(TransactionSplit).where(TransactionSplit.transaction_id.in_(data.ids)).values(date=data.date))
        db.flush()
        for transaction in transactions:
            service.notify_transaction_updated(db, user.id, transaction)

    elif data.action == BulkAction.duplicate:
        today = clock.today()
        for transaction in transactions:
            copy = service.create_transaction(db, user, _as_create(db, transaction, today))
            created_ids.append(copy.id)

    else:
        for transaction in transactions:
            paths.extend(service.delete_transaction(db, transaction))

    return {"affected": len(transactions), "created_ids": created_ids}, paths
