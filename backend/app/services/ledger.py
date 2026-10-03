import uuid
from collections.abc import Sequence
from datetime import date
from decimal import Decimal

from sqlalchemy import and_, case, extract, func, select
from sqlalchemy.orm import Session, aliased

from app.models.account import Account
from app.models.transaction import TransactionSplit


def credited_amount(destination):
    """Quanto entra na conta de destino (`destination`, um alias de Account) em cada split.

    O valor (`amount`) esta na moeda de quem paga. Quando a conta que recebe tem outra moeda
    (transferencia ou pagamento de divida entre moedas), o que entra nela e o `foreign_amount`,
    que a validacao garante estar na moeda dela. Nos demais casos o foreign_amount e so
    informativo (compra feita em dolar e paga em real) e o saldo usa o `amount`.
    """
    return case(
        (
            and_(
                TransactionSplit.currency_code != destination.currency_code,
                TransactionSplit.foreign_currency_code == destination.currency_code,
            ),
            TransactionSplit.foreign_amount,
        ),
        else_=TransactionSplit.amount,
    )


def balances_by_account(db: Session, account_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, Decimal]:
    """Saldo de varias contas em duas consultas (entradas e saidas), sem uma consulta por conta.

    Nao existe saldo guardado: o saldo e sempre o que entrou menos o que saiu, somando os splits.
    Assim ele nunca fica diferente das transacoes.
    """
    if not account_ids:
        return {}

    destination = aliased(Account)
    credited = credited_amount(destination)
    inflow = dict(
        db.execute(
            select(TransactionSplit.destination_account_id, func.sum(credited))
            .join(destination, destination.id == TransactionSplit.destination_account_id)
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


def monthly_changes(
    db: Session, account_ids: Sequence[uuid.UUID], up_to: date
) -> dict[uuid.UUID, dict[tuple[int, int], Decimal]]:
    """Quanto o saldo de cada conta mudou em cada mes (ano, mes), contando so os splits ate `up_to`.

    Usa a mesma regra de `balances_by_account` e tambem so duas consultas, agrupadas por conta e mes:
    quem acumula os meses em saldo e o chamador. Meses sem movimento nao aparecem.
    """
    if not account_ids:
        return {}

    year = extract("year", TransactionSplit.date)
    month = extract("month", TransactionSplit.date)
    destination = aliased(Account)
    inflow = db.execute(
        select(TransactionSplit.destination_account_id, year, month, func.sum(credited_amount(destination)))
        .join(destination, destination.id == TransactionSplit.destination_account_id)
        .where(TransactionSplit.destination_account_id.in_(account_ids), TransactionSplit.date <= up_to)
        .group_by(TransactionSplit.destination_account_id, year, month)
    ).all()
    outflow = db.execute(
        select(TransactionSplit.source_account_id, year, month, func.sum(TransactionSplit.amount))
        .where(TransactionSplit.source_account_id.in_(account_ids), TransactionSplit.date <= up_to)
        .group_by(TransactionSplit.source_account_id, year, month)
    ).all()

    changes: dict[uuid.UUID, dict[tuple[int, int], Decimal]] = {account_id: {} for account_id in account_ids}
    zero = Decimal("0")
    for account_id, y, m, total in inflow:
        key = (int(y), int(m))
        changes[account_id][key] = changes[account_id].get(key, zero) + total
    for account_id, y, m, total in outflow:
        key = (int(y), int(m))
        changes[account_id][key] = changes[account_id].get(key, zero) - total
    return changes


def account_balance(db: Session, account_id: uuid.UUID) -> Decimal:
    return balances_by_account(db, [account_id])[account_id]
