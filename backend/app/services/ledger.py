import uuid
from collections.abc import Sequence
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.transaction import TransactionSplit


def balances_by_account(db: Session, account_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, Decimal]:
    """Saldo de varias contas em duas consultas (entradas e saidas), sem uma consulta por conta.

    Nao existe saldo guardado: o saldo e sempre o que entrou menos o que saiu, somando os splits.
    Assim ele nunca fica diferente das transacoes.
    """
    if not account_ids:
        return {}

    inflow = dict(
        db.execute(
            select(TransactionSplit.destination_account_id, func.sum(TransactionSplit.amount))
            .where(TransactionSplit.destination_account_id.in_(account_ids))
            .group_by(TransactionSplit.destination_account_id)
        ).all()
    )
    outflow = dict(
        db.execute(
            select(TransactionSplit.source_account_id, func.sum(TransactionSplit.amount))
            .where(TransactionSplit.source_account_id.in_(account_ids))
            .group_by(TransactionSplit.source_account_id)
        ).all()
    )
    zero = Decimal("0")
    return {account_id: inflow.get(account_id, zero) - outflow.get(account_id, zero) for account_id in account_ids}


def account_balance(db: Session, account_id: uuid.UUID) -> Decimal:
    return balances_by_account(db, [account_id])[account_id]
