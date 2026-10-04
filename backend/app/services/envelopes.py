import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models.account import Account, AccountType
from app.models.budget import Budget, BudgetAllocation, BudgetMode
from app.models.currency import Currency
from app.models.transaction import TransactionSplit, TransactionType
from app.models.user import User
from app.services import envelope_calc as calc
from app.services.accounts import check_amount, get_currency, quantize_money
from app.services.budgets import get_owned_budget
from app.services.ledger import monthly_changes
from app.services.piggy_banks import reserved_by_account

ZERO = Decimal("0")


def _active_envelopes(db: Session, user_id: uuid.UUID) -> list[Budget]:
    return list(
        db.execute(
            select(Budget)
            .where(Budget.user_id == user_id, Budget.mode == BudgetMode.envelope, Budget.active.is_(True))
            .order_by(func.lower(Budget.name), Budget.id)
        ).scalars()
    )


def _allocations(db: Session, budget_ids: list[uuid.UUID], up_to: date) -> dict[uuid.UUID, dict[date, Decimal]]:
    found: dict[uuid.UUID, dict[date, Decimal]] = defaultdict(dict)
    rows = db.execute(
        select(BudgetAllocation.budget_id, BudgetAllocation.month, BudgetAllocation.amount).where(
            BudgetAllocation.budget_id.in_(budget_ids), BudgetAllocation.month <= up_to
        )
    ).all()
    for budget_id, month, amount in rows:
        found[budget_id][month] = amount
    return found


def _spent(db: Session, user_id: uuid.UUID, budget_ids: list[uuid.UUID], up_to: date) -> dict[uuid.UUID, dict[date, Decimal]]:
    """Gasto de cada envelope em cada mes, ate o fim do mes `up_to`: so saidas ligadas ao orcamento."""
    found: dict[uuid.UUID, dict[date, Decimal]] = defaultdict(dict)
    month = func.date_trunc("month", TransactionSplit.date)
    rows = db.execute(
        select(TransactionSplit.budget_id, month, func.sum(TransactionSplit.amount))
        .where(
            TransactionSplit.user_id == user_id,
            TransactionSplit.budget_id.in_(budget_ids),
            TransactionSplit.type == TransactionType.withdrawal,
            TransactionSplit.date <= calc.last_day_of_month(up_to),
        )
        .group_by(TransactionSplit.budget_id, month)
    ).all()
    for budget_id, first, total in rows:
        found[budget_id][first.date() if hasattr(first, "date") else first] = total
    return found


def _money_by_currency(db: Session, user_id: uuid.UUID, currencies: set[str], month: date) -> dict[str, Decimal]:
    """O dinheiro de cada moeda ate o fim do mes: saldo das contas de ativo ativas que entram nos envelopes, menos
    o que esta reservado nos cofrinhos delas (esse ja tem dono)."""
    accounts = list(
        db.execute(
            select(Account).where(
                Account.user_id == user_id,
                Account.type == AccountType.asset,
                Account.active.is_(True),
                Account.in_envelopes.is_(True),
                Account.currency_code.in_(currencies),
            )
        ).scalars()
    )
    end = calc.last_day_of_month(month)
    ids = [account.id for account in accounts]
    balances = {account_id: sum(months.values(), ZERO) for account_id, months in monthly_changes(db, ids, end).items()}
    reserved = reserved_by_account(db, ids, as_of=end)
    money: dict[str, Decimal] = {code: ZERO for code in currencies}
    for account in accounts:
        money[account.currency_code] += balances.get(account.id, ZERO) - reserved.get(account.id, ZERO)
    return money


def month_view(db: Session, user: User, month: date) -> dict:
    """Os envelopes de um mes e o "A orcar" de cada moeda. `month` e o primeiro dia do mes."""
    budgets = _active_envelopes(db, user.id)
    if not budgets:
        return {"month": month, "groups": []}

    ids = [budget.id for budget in budgets]
    allocations = _allocations(db, ids, month)
    spent = _spent(db, user.id, ids, month)
    currencies = {budget.currency_code for budget in budgets}
    money = _money_by_currency(db, user.id, currencies, month)
    places = dict(db.execute(select(Currency.code, Currency.decimal_places).where(Currency.code.in_(currencies))).all())

    groups = []
    for code in sorted(currencies):
        decimals = places[code]

        def q(value: Decimal) -> Decimal:
            return quantize_money(value, decimals)

        figures = {
            budget.id: calc.envelope_month(allocations.get(budget.id, {}), spent.get(budget.id, {}), month)
            for budget in budgets
            if budget.currency_code == code
        }
        groups.append(
            {
                "currency_code": code,
                "money": q(money[code]),
                "in_envelopes": q(sum((item.in_envelope for item in figures.values()), ZERO)),
                "to_budget": q(calc.to_budget(money[code], figures.values())),
                "envelopes": [
                    {
                        "budget_id": budget.id,
                        "name": budget.name,
                        "carried": q(figures[budget.id].carried),
                        "allocated": q(figures[budget.id].allocated),
                        "spent": q(figures[budget.id].spent),
                        "available": q(figures[budget.id].available),
                        "overspent": q(figures[budget.id].overspent),
                    }
                    for budget in budgets
                    if budget.currency_code == code
                ],
            }
        )
    return {"month": month, "groups": groups}


# ---------- Distribuir ----------


def _owned_envelope(db: Session, user_id: uuid.UUID, budget_id: uuid.UUID, lock: bool = False) -> Budget:
    budget = get_owned_budget(db, user_id, budget_id)
    if budget.mode != BudgetMode.envelope or not budget.active:
        raise AppError(400, ErrorCode.BUDGET_NOT_ENVELOPE, "Este orcamento nao e um envelope ativo")
    if lock:
        db.execute(select(Budget.id).where(Budget.id == budget.id).with_for_update())
    return budget


def _apply(db: Session, user_id: uuid.UUID, budget_id: uuid.UUID, month: date, amount: Decimal) -> None:
    """Grava o valor distribuido: zero apaga a linha, qualquer outro valor cria ou troca."""
    existing = db.execute(
        select(BudgetAllocation).where(BudgetAllocation.budget_id == budget_id, BudgetAllocation.month == month)
    ).scalar_one_or_none()
    if amount == ZERO:
        if existing is not None:
            db.delete(existing)
            db.flush()
        return
    if existing is None:
        db.add(BudgetAllocation(user_id=user_id, budget_id=budget_id, month=month, amount=amount))
    else:
        existing.amount = amount
    db.flush()


def set_allocation(db: Session, user: User, budget_id: uuid.UUID, month: date, amount: Decimal) -> None:
    budget = _owned_envelope(db, user.id, budget_id, lock=True)
    check_amount(get_currency(db, budget.currency_code), amount)
    _apply(db, user.id, budget.id, month, amount)


def move(db: Session, user: User, from_id: uuid.UUID, to_id: uuid.UUID, month: date, amount: Decimal) -> None:
    """Passa dinheiro de um envelope para outro neste mes (e assim que se cobre um estouro). Tira do disponivel do
    primeiro, entao nao da para mover mais do que ele tem."""
    if from_id == to_id:
        raise AppError(422, ErrorCode.VALIDATION_ERROR, "Escolha dois envelopes diferentes")
    # Trava na mesma ordem sempre: dois movimentos juntos nao se travam um ao outro
    first_id, second_id = sorted((from_id, to_id), key=str)
    first = _owned_envelope(db, user.id, first_id, lock=True)
    second = _owned_envelope(db, user.id, second_id, lock=True)
    source, target = (first, second) if first.id == from_id else (second, first)
    if source.currency_code != target.currency_code:
        raise AppError(400, ErrorCode.CURRENCY_MISMATCH, "Os dois envelopes precisam estar na mesma moeda")
    check_amount(get_currency(db, source.currency_code), amount)

    figures = calc.envelope_month(
        _allocations(db, [source.id], month).get(source.id, {}), _spent(db, user.id, [source.id], month).get(source.id, {}), month
    )
    if figures.available < amount:
        raise AppError(400, ErrorCode.ENVELOPE_NOT_ENOUGH, "O envelope de origem nao tem esse valor disponivel")

    current = {
        row.budget_id: row.amount
        for row in db.execute(
            select(BudgetAllocation).where(
                BudgetAllocation.budget_id.in_([source.id, target.id]), BudgetAllocation.month == month
            )
        ).scalars()
    }
    _apply(db, user.id, source.id, month, current.get(source.id, ZERO) - amount)
    _apply(db, user.id, target.id, month, current.get(target.id, ZERO) + amount)
