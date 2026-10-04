"""O que os lancamentos precisam saber da conciliacao: se estao conferidos ou travados.

Fica separado do servico de conciliacao porque o servico de lancamentos usa isto e a conciliacao usa o de lancamentos."""

import uuid
from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models.reconciliation import AccountClearing
from app.models.transaction import TransactionSplit


def assert_unlocked(db: Session, transaction_id: uuid.UUID) -> None:
    """Um lancamento travado (de qualquer um dos lados) nao se edita nem se exclui."""
    locked = db.scalar(
        select(AccountClearing.id)
        .join(TransactionSplit, TransactionSplit.id == AccountClearing.split_id)
        .where(TransactionSplit.transaction_id == transaction_id, AccountClearing.reconciliation_id.is_not(None))
        .limit(1)
    )
    if locked is not None:
        raise AppError(
            409,
            ErrorCode.TRANSACTION_LOCKED,
            "Este lancamento foi conciliado e esta travado: destrave antes de editar ou excluir",
        )


def clearing_states(db: Session, split_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, tuple[bool, bool]]:
    """Por split: (conferido em algum lado, travado em algum lado)."""
    if not split_ids:
        return {}
    states: dict[uuid.UUID, list[bool]] = defaultdict(lambda: [False, False])
    for split_id, reconciliation_id in db.execute(
        select(AccountClearing.split_id, AccountClearing.reconciliation_id).where(AccountClearing.split_id.in_(split_ids))
    ):
        states[split_id][0] = True
        if reconciliation_id is not None:
            states[split_id][1] = True
    return {split_id: (flags[0], flags[1]) for split_id, flags in states.items()}


def capture_clearings(db: Session, transaction_id: uuid.UUID) -> dict[int, list[uuid.UUID]]:
    """O que ja estava conferido, por posicao do split: a edicao recria os splits e precisa devolver isso."""
    found: dict[int, list[uuid.UUID]] = defaultdict(list)
    for position, account_id in db.execute(
        select(TransactionSplit.position, AccountClearing.account_id)
        .join(AccountClearing, AccountClearing.split_id == TransactionSplit.id)
        .where(TransactionSplit.transaction_id == transaction_id)
    ):
        found[position].append(account_id)
    return found


def restore_clearings(db: Session, user_id: uuid.UUID, split: TransactionSplit, account_ids: Sequence[uuid.UUID]) -> None:
    """Devolve a conferencia aos lados que ainda fazem parte do lancamento depois de editado."""
    for account_id in account_ids:
        if account_id in (split.source_account_id, split.destination_account_id):
            db.add(AccountClearing(user_id=user_id, split_id=split.id, account_id=account_id))


def mark_cleared(db: Session, user_id: uuid.UUID, split_id: uuid.UUID, account_id: uuid.UUID) -> None:
    """Para quem cria lancamento ja conferido (a importacao de extrato)."""
    db.add(AccountClearing(user_id=user_id, split_id=split_id, account_id=account_id))
    db.flush()
