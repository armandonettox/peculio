import uuid
from collections import defaultdict
from collections.abc import Sequence
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.orm import Session, aliased

from app.core.errors import AppError, ErrorCode
from app.models.account import Account, AccountType
from app.models.reconciliation import AccountClearing, Reconciliation
from app.models.transaction import TransactionSplit, TransactionType
from app.models.user import User
from app.schemas.reconciliation import MAX_ROWS
from app.schemas.transaction import TransactionCreate, TransactionSplitCreate
from app.services import recon_calc as calc
from app.services.accounts import check_amount, get_currency, get_owned_account, quantize_money
from app.services.clearings import mark_cleared  # noqa: F401
from app.services.ledger import credited_amount, monthly_changes
from app.services.transactions import create_transaction

ZERO = Decimal("0")
ADJUSTMENT_TEXT = "Ajuste de conciliacao"


def _asset(db: Session, user: User, account_id: uuid.UUID) -> Account:
    account = get_owned_account(db, user.id, account_id)
    if account.type != AccountType.asset:
        raise AppError(400, ErrorCode.RECONCILIATION_ACCOUNT_INVALID, "So uma conta de ativo pode ser conciliada")
    return account


def _not_opening():
    return TransactionSplit.type != TransactionType.opening_balance


# ---------- Numeros ----------


def _cleared_sum(db: Session, account: Account, up_to: date) -> Decimal:
    """Tudo o que foi conferido na conta ate `up_to` (entradas menos saidas), travado ou nao."""
    destination = aliased(Account)
    inflow = db.scalar(
        select(func.coalesce(func.sum(credited_amount(destination)), 0))
        .select_from(AccountClearing)
        .join(TransactionSplit, TransactionSplit.id == AccountClearing.split_id)
        .join(destination, destination.id == TransactionSplit.destination_account_id)
        .where(
            AccountClearing.account_id == account.id,
            TransactionSplit.destination_account_id == account.id,
            TransactionSplit.date <= up_to,
            _not_opening(),
        )
    )
    outflow = db.scalar(
        select(func.coalesce(func.sum(TransactionSplit.amount), 0))
        .select_from(AccountClearing)
        .join(TransactionSplit, TransactionSplit.id == AccountClearing.split_id)
        .where(
            AccountClearing.account_id == account.id,
            TransactionSplit.source_account_id == account.id,
            TransactionSplit.date <= up_to,
            _not_opening(),
        )
    )
    return inflow - outflow


def _opening_effect(db: Session, account: Account, up_to: date) -> Decimal:
    """O saldo inicial conta como conferido (ele e o ponto de partida), se ja existia na data do extrato."""
    split = db.execute(
        select(TransactionSplit).where(
            TransactionSplit.type == TransactionType.opening_balance,
            or_(TransactionSplit.source_account_id == account.id, TransactionSplit.destination_account_id == account.id),
        )
    ).scalars().first()
    if split is None or split.date > up_to:
        return ZERO
    return calc.signed_effect(split.destination_account_id == account.id, split.amount)


def cleared_balance(db: Session, account: Account, up_to: date) -> Decimal:
    return _opening_effect(db, account, up_to) + _cleared_sum(db, account, up_to)


def _book_balance(db: Session, account: Account, up_to: date) -> Decimal:
    changes = monthly_changes(db, [account.id], up_to)
    return sum(changes.get(account.id, {}).values(), ZERO)


def _rows(db: Session, account: Account, up_to: date) -> tuple[list[dict], int]:
    """Os lancamentos abertos da conta ate `up_to` (nao travados), do mais novo para o mais antigo."""
    destination = aliased(Account)
    own = (
        select(TransactionSplit, AccountClearing.id.label("clearing_id"), AccountClearing.reconciliation_id, credited_amount(destination).label("credited"))
        .join(destination, destination.id == TransactionSplit.destination_account_id)
        .outerjoin(
            AccountClearing,
            and_(AccountClearing.split_id == TransactionSplit.id, AccountClearing.account_id == account.id),
        )
        .where(
            or_(TransactionSplit.source_account_id == account.id, TransactionSplit.destination_account_id == account.id),
            TransactionSplit.date <= up_to,
            _not_opening(),
            # Travado (conciliacao fechada) nao aparece mais: ja foi batido com o banco
            AccountClearing.reconciliation_id.is_(None),
        )
    )
    total = db.scalar(select(func.count()).select_from(own.order_by(None).subquery()))
    found = db.execute(own.order_by(TransactionSplit.date.desc(), TransactionSplit.id).limit(MAX_ROWS)).all()
    rows = []
    for split, clearing_id, _reconciliation_id, credited in found:
        incoming = split.destination_account_id == account.id
        rows.append(
            {
                "split_id": split.id,
                "transaction_id": split.transaction_id,
                "date": split.date,
                "description": split.description,
                "amount": calc.signed_effect(incoming, credited if incoming else split.amount),
                "cleared": clearing_id is not None,
            }
        )
    return rows, total


def view(db: Session, user: User, account_id: uuid.UUID, statement_balance: Decimal, statement_date: date) -> dict:
    account = _asset(db, user, account_id)
    currency = get_currency(db, account.currency_code)
    check_amount(currency, statement_balance)
    places = currency.decimal_places
    cleared = cleared_balance(db, account, statement_date)
    diff = calc.difference(statement_balance, cleared)
    rows, total = _rows(db, account, statement_date)
    q = lambda value: quantize_money(value, places)  # noqa: E731
    return {
        "account_id": account.id,
        "account_name": account.name,
        "currency_code": account.currency_code,
        "statement_date": statement_date,
        "statement_balance": q(statement_balance),
        "cleared_balance": q(cleared),
        "difference": q(diff),
        "book_balance": q(_book_balance(db, account, statement_date)),
        "reconciled": calc.is_reconciled(diff),
        "rows": [{**row, "amount": q(row["amount"])} for row in rows],
        "total_rows": total,
        "truncated": total > len(rows),
    }


# ---------- Conferir ----------


def _own_splits(db: Session, user: User, account: Account, split_ids: Sequence[uuid.UUID]) -> list[TransactionSplit]:
    splits = list(
        db.execute(
            select(TransactionSplit).where(TransactionSplit.id.in_(split_ids), TransactionSplit.user_id == user.id)
        ).scalars()
    )
    valid = [
        split for split in splits
        if account.id in (split.source_account_id, split.destination_account_id) and split.type != TransactionType.opening_balance
    ]
    if len({*split_ids}) != len(valid):
        raise AppError(400, ErrorCode.RECONCILIATION_SPLIT_INVALID, "Um dos lancamentos nao pertence a esta conta")
    return valid


def set_cleared(db: Session, user: User, account_id: uuid.UUID, split_ids: Sequence[uuid.UUID], cleared: bool) -> int:
    """Marca ou desmarca lancamentos como conferidos. Devolve quantos mudaram. Tudo ou nada: um travado barra o pedido."""
    account = _asset(db, user, account_id)
    splits = _own_splits(db, user, account, split_ids)
    ids = [split.id for split in splits]
    existing = {
        row.split_id: row
        for row in db.execute(
            select(AccountClearing).where(AccountClearing.account_id == account.id, AccountClearing.split_id.in_(ids))
        ).scalars()
    }
    if cleared:
        new = [split for split in splits if split.id not in existing]
        for split in new:
            db.add(AccountClearing(user_id=user.id, split_id=split.id, account_id=account.id))
        db.flush()
        return len(new)
    if any(row.reconciliation_id is not None for row in existing.values()):
        raise AppError(409, ErrorCode.TRANSACTION_LOCKED, "Um dos lancamentos esta travado por uma conciliacao fechada: destrave antes")
    for row in existing.values():
        db.delete(row)
    db.flush()
    return len(existing)


# ---------- Ajuste e fechar ----------


def adjust(db: Session, user: User, account_id: uuid.UUID, statement_balance: Decimal, statement_date: date) -> None:
    """Cria o lancamento "Ajuste de conciliacao" que zera a diferenca e ja o marca como conferido."""
    account = _asset(db, user, account_id)
    check_amount(get_currency(db, account.currency_code), statement_balance)
    diff = calc.difference(statement_balance, cleared_balance(db, account, statement_date))
    needed = calc.adjustment(diff)
    if needed is None:
        raise AppError(400, ErrorCode.RECONCILIATION_NO_DIFFERENCE, "Nao ha diferenca para ajustar")
    kind, amount = needed
    split = TransactionSplitCreate(
        type=TransactionType.deposit if kind == "deposit" else TransactionType.withdrawal,
        date=statement_date,
        description=ADJUSTMENT_TEXT,
        amount=amount,
        currency_code=account.currency_code,
        account_id=account.id,
        counterparty_name=ADJUSTMENT_TEXT,
    )
    transaction = create_transaction(db, user, TransactionCreate(splits=[split]))
    created = db.execute(select(TransactionSplit.id).where(TransactionSplit.transaction_id == transaction.id)).scalar_one()
    db.add(AccountClearing(user_id=user.id, split_id=created, account_id=account.id))
    db.flush()


def close(db: Session, user: User, account_id: uuid.UUID, statement_balance: Decimal, statement_date: date) -> Reconciliation:
    """Fecha a conciliacao: so com diferenca zero. Trava o que foi conferido ate a data do extrato."""
    account = _asset(db, user, account_id)
    check_amount(get_currency(db, account.currency_code), statement_balance)
    diff = calc.difference(statement_balance, cleared_balance(db, account, statement_date))
    if not calc.is_reconciled(diff):
        raise AppError(400, ErrorCode.RECONCILIATION_DIFFERENCE, "Ainda ha diferenca: o conferido nao bate com o extrato")
    open_ids = list(
        db.execute(
            select(AccountClearing.id)
            .join(TransactionSplit, TransactionSplit.id == AccountClearing.split_id)
            .where(
                AccountClearing.account_id == account.id,
                AccountClearing.reconciliation_id.is_(None),
                TransactionSplit.date <= statement_date,
            )
        ).scalars()
    )
    if not open_ids:
        raise AppError(400, ErrorCode.RECONCILIATION_NOTHING, "Nao ha lancamentos conferidos para fechar")
    record = Reconciliation(
        user_id=user.id, account_id=account.id, statement_date=statement_date, statement_balance=statement_balance
    )
    db.add(record)
    db.flush()
    db.execute(update(AccountClearing).where(AccountClearing.id.in_(open_ids)).values(reconciliation_id=record.id))
    db.flush()
    return record


# ---------- Historico e destravar ----------


def history(db: Session, user: User, account_id: uuid.UUID) -> list[dict]:
    account = _asset(db, user, account_id)
    records = list(
        db.execute(
            select(Reconciliation)
            .where(Reconciliation.account_id == account.id)
            .order_by(Reconciliation.statement_date.desc(), Reconciliation.closed_at.desc(), Reconciliation.id)
        ).scalars()
    )
    counts = dict(
        db.execute(
            select(AccountClearing.reconciliation_id, func.count())
            .where(AccountClearing.reconciliation_id.in_([record.id for record in records]))
            .group_by(AccountClearing.reconciliation_id)
        ).all()
    ) if records else {}
    return [
        {
            "id": record.id, "account_id": record.account_id, "statement_date": record.statement_date,
            "statement_balance": record.statement_balance, "closed_at": record.closed_at,
            "invalidated_at": record.invalidated_at, "locked_count": counts.get(record.id, 0),
        }
        for record in records
    ]


def _invalidate(db: Session, reconciliation_ids: set[uuid.UUID]) -> None:
    if reconciliation_ids:
        db.execute(
            update(Reconciliation)
            .where(Reconciliation.id.in_(reconciliation_ids), Reconciliation.invalidated_at.is_(None))
            .values(invalidated_at=datetime.now(timezone.utc))
        )


def unlock(db: Session, user: User, account_id: uuid.UUID, split_ids: Sequence[uuid.UUID]) -> int:
    """Destrava lancamentos (continuam conferidos). A conciliacao de que faziam parte deixa de valer."""
    account = _asset(db, user, account_id)
    splits = _own_splits(db, user, account, split_ids)
    rows = list(
        db.execute(
            select(AccountClearing).where(
                AccountClearing.account_id == account.id,
                AccountClearing.split_id.in_([split.id for split in splits]),
                AccountClearing.reconciliation_id.is_not(None),
            )
        ).scalars()
    )
    _invalidate(db, {row.reconciliation_id for row in rows})
    for row in rows:
        row.reconciliation_id = None
    db.flush()
    return len(rows)


def undo(db: Session, user: User, account_id: uuid.UUID, reconciliation_id: uuid.UUID) -> int:
    """Desfaz uma conciliacao inteira: destrava tudo o que ela travou. Fica no historico como desfeita."""
    account = _asset(db, user, account_id)
    record = db.execute(
        select(Reconciliation).where(Reconciliation.id == reconciliation_id, Reconciliation.account_id == account.id)
    ).scalar_one_or_none()
    if record is None:
        raise AppError(404, ErrorCode.RECONCILIATION_NOT_FOUND, "Conciliacao nao encontrada")
    rows = list(db.execute(select(AccountClearing).where(AccountClearing.reconciliation_id == record.id)).scalars())
    for row in rows:
        row.reconciliation_id = None
    _invalidate(db, {record.id})
    db.flush()
    return len(rows)
