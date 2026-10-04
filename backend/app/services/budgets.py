import calendar
import uuid
from collections import defaultdict
from collections.abc import Sequence
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.core.pagination import PageParams, paginate
from app.models.budget import Budget, BudgetMode, BudgetPeriod
from app.models.currency import Currency
from app.models.transaction import TransactionSplit, TransactionType
from app.models.user import User
from app.schemas.budget import BudgetCreate, BudgetUpdate
from app.services.accounts import check_amount, get_currency, quantize_money


def period_bounds(period: BudgetPeriod, reference: date) -> tuple[date, date]:
    """Primeiro e ultimo dia (inclusive) do periodo que contem `reference`.

    A semana vai de segunda a domingo (ISO). O mes e o ano seguem o calendario."""
    if period == BudgetPeriod.weekly:
        start = reference - timedelta(days=reference.weekday())
        return start, start + timedelta(days=6)
    if period == BudgetPeriod.monthly:
        last = calendar.monthrange(reference.year, reference.month)[1]
        return reference.replace(day=1), reference.replace(day=last)
    return date(reference.year, 1, 1), date(reference.year, 12, 31)


def get_owned_budget(db: Session, user_id: uuid.UUID, budget_id: uuid.UUID) -> Budget:
    """404 tambem quando o orcamento e de outro usuario, para nao revelar que ele existe."""
    budget = db.execute(select(Budget).where(Budget.id == budget_id, Budget.user_id == user_id)).scalar_one_or_none()
    if not budget:
        raise AppError(404, ErrorCode.BUDGET_NOT_FOUND, "Orcamento nao encontrado")
    return budget


def _save(db: Session, budget: Budget) -> None:
    # A unicidade e do banco (indice em lower(nome)): vale mesmo com duas requisicoes juntas
    try:
        with db.begin_nested():
            db.add(budget)
            db.flush()
    except IntegrityError:
        raise AppError(409, ErrorCode.BUDGET_NAME_TAKEN, "Ja existe um orcamento com esse nome")


def create_budget(db: Session, user: User, data: BudgetCreate) -> Budget:
    currency = get_currency(db, data.currency_code)
    if data.mode == BudgetMode.fixed:
        check_amount(currency, data.amount)
    budget = Budget(
        user_id=user.id,
        name=data.name,
        currency_code=currency.code,
        mode=data.mode,
        amount=data.amount,
        # Envelope e sempre mensal
        period=data.period or BudgetPeriod.monthly,
    )
    _save(db, budget)
    return budget


def update_budget(db: Session, budget: Budget, data: BudgetUpdate) -> Budget:
    changes = data.model_dump(exclude_unset=True)
    # Campo enviado como null nao apaga nada: nenhum destes campos aceita vazio
    changes = {field: value for field, value in changes.items() if value is not None}
    if budget.mode == BudgetMode.envelope and ("amount" in changes or "period" in changes):
        raise AppError(422, ErrorCode.VALIDATION_ERROR, "Envelope nao tem limite nem periodo: a distribuicao e por mes")
    if "amount" in changes:
        check_amount(get_currency(db, budget.currency_code), changes["amount"])
    for field, value in changes.items():
        setattr(budget, field, value)
    _save(db, budget)
    return budget


def delete_budget(db: Session, budget: Budget) -> None:
    # Os lancamentos ligados ficam sem orcamento (ON DELETE SET NULL no banco)
    db.delete(budget)
    db.flush()


def _places(db: Session, codes: set[str]) -> dict[str, int]:
    if not codes:
        return {}
    return dict(db.execute(select(Currency.code, Currency.decimal_places).where(Currency.code.in_(codes))).all())


def budget_output(budget: Budget, places: int) -> dict:
    return {
        "id": budget.id,
        "name": budget.name,
        "currency_code": budget.currency_code,
        "mode": budget.mode,
        "amount": None if budget.amount is None else quantize_money(budget.amount, places),
        "period": budget.period,
        "active": budget.active,
        "created_at": budget.created_at,
    }


def build_outputs(db: Session, budgets: Sequence[Budget]) -> list[dict]:
    places = _places(db, {budget.currency_code for budget in budgets})
    return [budget_output(budget, places[budget.currency_code]) for budget in budgets]


def list_budgets(db: Session, user_id: uuid.UUID, params: PageParams, q: str | None, active: bool | None) -> dict:
    statement = select(Budget).where(Budget.user_id == user_id)
    if active is not None:
        statement = statement.where(Budget.active == active)
    if q and q.strip():
        # autoescape: um "%" ou "_" digitado na busca e texto comum, nao curinga
        statement = statement.where(func.lower(Budget.name).contains(q.strip().lower(), autoescape=True))
    page = paginate(db, statement.order_by(func.lower(Budget.name), Budget.id), params)
    page["items"] = build_outputs(db, page["items"])
    return page


def _spent_by_budget(
    db: Session, user_id: uuid.UUID, budgets: Sequence[Budget], bounds: dict[uuid.UUID, tuple[date, date]]
) -> dict[uuid.UUID, Decimal]:
    """Gasto de cada orcamento no proprio periodo. Orcamentos com o mesmo intervalo de datas
    entram na mesma consulta, entao sao no maximo 3 consultas (semana, mes e ano)."""
    by_range: dict[tuple[date, date], list[uuid.UUID]] = defaultdict(list)
    for budget in budgets:
        by_range[bounds[budget.id]].append(budget.id)

    spent: dict[uuid.UUID, Decimal] = {}
    for (start, end), ids in by_range.items():
        rows = db.execute(
            select(TransactionSplit.budget_id, func.sum(TransactionSplit.amount))
            .where(
                TransactionSplit.user_id == user_id,
                TransactionSplit.budget_id.in_(ids),
                TransactionSplit.type == TransactionType.withdrawal,
                TransactionSplit.date >= start,
                TransactionSplit.date <= end,
            )
            .group_by(TransactionSplit.budget_id)
        ).all()
        spent.update({budget_id: total for budget_id, total in rows})
    return spent


def progress(db: Session, user_id: uuid.UUID, on: date, include_archived: bool) -> list[dict]:
    """Orcamentos com o gasto do periodo que contem `on`, em ordem alfabetica."""
    # Envelope nao tem limite: nao entra no progresso (a tela de envelopes e a dele)
    statement = select(Budget).where(Budget.user_id == user_id, Budget.mode == BudgetMode.fixed)
    if not include_archived:
        statement = statement.where(Budget.active.is_(True))
    budgets = list(db.execute(statement.order_by(func.lower(Budget.name), Budget.id)).scalars())
    if not budgets:
        return []

    bounds = {budget.id: period_bounds(budget.period, on) for budget in budgets}
    spent = _spent_by_budget(db, user_id, budgets, bounds)
    places = _places(db, {budget.currency_code for budget in budgets})

    items = []
    for budget in budgets:
        decimals = places[budget.currency_code]
        total = quantize_money(spent.get(budget.id, Decimal(0)), decimals)
        limit = quantize_money(budget.amount, decimals)
        start, end = bounds[budget.id]
        items.append(
            {
                **budget_output(budget, decimals),
                "period_start": start,
                "period_end": end,
                "spent": total,
                "remaining": limit - total,
                # Divisao inteira de Decimals: nunca arredonda para cima, 99,9% continua 99
                "percent": int((total * 100) // limit),
            }
        )
    return items
