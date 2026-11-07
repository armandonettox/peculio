import calendar
import uuid
from collections import defaultdict
from collections.abc import Sequence
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import clock
from app.core.errors import AppError, ErrorCode
from app.core.pagination import PageParams, paginate
from app.models.budget import Budget, BudgetAlertLevel, BudgetCategory, BudgetPeriod
from app.models.category import CategoryKind
from app.models.currency import Currency
from app.models.transaction import TransactionSplit, TransactionType
from app.models.user import User
from app.schemas.budget import BudgetCreate, BudgetUpdate, check_dates
from app.services import budget_calc as calc
from app.services.accounts import check_amount, get_currency, quantize_money
from app.services.webhooks import enqueue_event

ZERO = Decimal("0")

# A partir de quantos % do limite o orcamento passa a ser "perto do limite" (o mesmo numero da tela)
WARNING_AT_PERCENT = 80


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
    check_amount(currency, data.amount)
    budget = Budget(
        user_id=user.id,
        name=data.name,
        currency_code=currency.code,
        amount=data.amount,
        period=data.period,
        carry_over=data.carry_over,
        start_date=data.start_date,
        end_date=data.end_date,
        alert=data.alert,
    )
    _check_categories(db, user.id, data.category_ids)
    _save(db, budget)
    _set_categories(db, budget, data.category_ids)
    _reset_alert(db, budget)
    return budget


def _check_categories(db: Session, user_id: uuid.UUID, category_ids: Sequence[uuid.UUID]) -> None:
    """So categorias de gasto da propria pessoa: orcamento limita saida."""
    # Import aqui dentro: o servico de lancamentos ja importa este modulo
    from app.services.transactions import get_owned_category

    for category_id in set(category_ids):
        category = get_owned_category(db, user_id, category_id)
        if category.kind != CategoryKind.expense:
            raise AppError(
                400,
                ErrorCode.CATEGORY_KIND_MISMATCH,
                "Orcamento so tem categorias de saida: escolha uma categoria de gasto",
            )


def _set_categories(db: Session, budget: Budget, category_ids: Sequence[uuid.UUID]) -> None:
    db.execute(delete(BudgetCategory).where(BudgetCategory.budget_id == budget.id))
    for category_id in dict.fromkeys(category_ids):
        db.add(BudgetCategory(budget_id=budget.id, category_id=category_id))
    db.flush()


def update_budget(db: Session, budget: Budget, data: BudgetUpdate) -> Budget:
    changes = data.model_dump(exclude_unset=True)
    # Campo enviado como null nao apaga nada: nenhum destes campos aceita vazio
    changes = {field: value for field, value in changes.items() if value is not None}
    category_ids = changes.pop("category_ids", None)
    if "amount" in changes:
        check_amount(get_currency(db, budget.currency_code), changes["amount"])
    next_carry_over = changes.get("carry_over", budget.carry_over)
    next_period = changes.get("period", budget.period)
    if next_carry_over and next_period != BudgetPeriod.monthly:
        raise AppError(422, ErrorCode.VALIDATION_ERROR, "Carregar a sobra so vale com periodo mensal")
    # Fora do periodo personalizado as datas somem; nele, valem as novas ou as que ja existiam
    if next_period == BudgetPeriod.custom:
        start = changes.get("start_date", budget.start_date)
        end = changes.get("end_date", budget.end_date)
    else:
        start = end = None
        changes["start_date"] = changes["end_date"] = None
    try:
        check_dates(next_period, start, end)
    except ValueError as error:
        raise AppError(422, ErrorCode.VALIDATION_ERROR, str(error))
    if category_ids is not None:
        _check_categories(db, budget.user_id, category_ids)
    for field, value in changes.items():
        setattr(budget, field, value)
    _save(db, budget)
    if category_ids is not None:
        _set_categories(db, budget, category_ids)
    # Ligou o alerta (ou o orcamento mudou de periodo): o aviso parte do nivel de agora, sem avisar do que ja passou
    if "alert" in changes or "period" in changes or "start_date" in changes:
        _reset_alert(db, budget)
    return budget


def delete_budget(db: Session, budget: Budget) -> None:
    # Os lancamentos ligados ficam sem orcamento (ON DELETE SET NULL no banco)
    db.delete(budget)
    db.flush()


def _places(db: Session, codes: set[str]) -> dict[str, int]:
    if not codes:
        return {}
    return dict(db.execute(select(Currency.code, Currency.decimal_places).where(Currency.code.in_(codes))).all())


def _category_ids(db: Session, budget_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
    found: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    if not budget_ids:
        return found
    rows = db.execute(
        select(BudgetCategory.budget_id, BudgetCategory.category_id)
        .where(BudgetCategory.budget_id.in_(budget_ids))
        .order_by(BudgetCategory.category_id)
    ).all()
    for budget_id, category_id in rows:
        found[budget_id].append(category_id)
    return found


def budget_output(budget: Budget, places: int, category_ids: Sequence[uuid.UUID] = ()) -> dict:
    return {
        "id": budget.id,
        "name": budget.name,
        "currency_code": budget.currency_code,
        "amount": quantize_money(budget.amount, places),
        "period": budget.period,
        "carry_over": budget.carry_over,
        "active": budget.active,
        "start_date": budget.start_date,
        "end_date": budget.end_date,
        "category_ids": list(category_ids),
        "alert": budget.alert,
        "created_at": budget.created_at,
    }


def build_outputs(db: Session, budgets: Sequence[Budget]) -> list[dict]:
    places = _places(db, {budget.currency_code for budget in budgets})
    categories = _category_ids(db, [budget.id for budget in budgets])
    return [budget_output(budget, places[budget.currency_code], categories[budget.id]) for budget in budgets]


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


def _matches(budget: Budget, category_ids: Sequence[uuid.UUID]):
    """Os lancamentos que contam para o orcamento: os ligados a ele ou, se ele tem categorias, os de uma delas na
    moeda dele. E uma condicao so (OR), entao um lancamento nunca conta duas vezes no mesmo orcamento."""
    linked = TransactionSplit.budget_id == budget.id
    if not category_ids:
        return linked
    return or_(
        linked,
        and_(TransactionSplit.category_id.in_(category_ids), TransactionSplit.currency_code == budget.currency_code),
    )


def _outflows(user_id: uuid.UUID):
    return (
        TransactionSplit.user_id == user_id,
        TransactionSplit.ignored.is_(False),
        TransactionSplit.type == TransactionType.withdrawal,
    )


def _spent_by_budget(
    db: Session,
    user_id: uuid.UUID,
    budgets: Sequence[Budget],
    bounds: dict[uuid.UUID, tuple[date, date]],
    categories: dict[uuid.UUID, list[uuid.UUID]],
) -> dict[uuid.UUID, Decimal]:
    """Gasto de cada orcamento no proprio periodo. Os que so contam lancamentos ligados e tem o mesmo intervalo de
    datas entram na mesma consulta; os que tem categorias fazem a sua."""
    spent: dict[uuid.UUID, Decimal] = {}
    by_range: dict[tuple[date, date], list[uuid.UUID]] = defaultdict(list)
    for budget in budgets:
        if categories[budget.id]:
            start, end = bounds[budget.id]
            total = db.scalar(
                select(func.sum(TransactionSplit.amount)).where(
                    *_outflows(user_id),
                    _matches(budget, categories[budget.id]),
                    TransactionSplit.date >= start,
                    TransactionSplit.date <= end,
                )
            )
            spent[budget.id] = total or ZERO
        else:
            by_range[bounds[budget.id]].append(budget.id)

    for (start, end), ids in by_range.items():
        rows = db.execute(
            select(TransactionSplit.budget_id, func.sum(TransactionSplit.amount))
            .where(
                *_outflows(user_id),
                TransactionSplit.budget_id.in_(ids),
                TransactionSplit.date >= start,
                TransactionSplit.date <= end,
            )
            .group_by(TransactionSplit.budget_id)
        ).all()
        spent.update({budget_id: total for budget_id, total in rows})
    return spent


def _spent_by_month(
    db: Session,
    user_id: uuid.UUID,
    budgets: Sequence[Budget],
    categories: dict[uuid.UUID, list[uuid.UUID]],
    up_to: date,
) -> dict[uuid.UUID, dict[date, Decimal]]:
    """Gasto de cada orcamento em cada mes, ate o fim do mes `up_to`: saidas ligadas ao orcamento e, se ele tem
    categorias, as dessas categorias."""
    found: dict[uuid.UUID, dict[date, Decimal]] = defaultdict(dict)
    month = func.date_trunc("month", TransactionSplit.date)
    for budget in budgets:
        rows = db.execute(
            select(month, func.sum(TransactionSplit.amount))
            .where(
                *_outflows(user_id),
                _matches(budget, categories[budget.id]),
                TransactionSplit.date <= calc.last_day_of_month(up_to),
            )
            .group_by(month)
        ).all()
        for first, total in rows:
            found[budget.id][first.date() if hasattr(first, "date") else first] = total
    return found


def _percent(spent: Decimal, limit: Decimal) -> int:
    if limit <= ZERO:
        return 100 if spent > ZERO else 0
    # Divisao inteira de Decimals: nunca arredonda para cima, 99,9% continua 99
    return int((spent * 100) // limit)


def _bounds(budget: Budget, on: date) -> tuple[date, date]:
    # O personalizado tem o proprio intervalo, seja qual for a data pedida
    if budget.period == BudgetPeriod.custom:
        return budget.start_date, budget.end_date
    return period_bounds(budget.period, on)


def progress(
    db: Session, user_id: uuid.UUID, on: date, include_archived: bool, only: set[uuid.UUID] | None = None
) -> list[dict]:
    """Orcamentos com o gasto do periodo que contem `on` (o personalizado, o proprio intervalo), em ordem alfabetica."""
    statement = select(Budget).where(Budget.user_id == user_id)
    if not include_archived:
        statement = statement.where(Budget.active.is_(True))
    if only is not None:
        statement = statement.where(Budget.id.in_(only))
    budgets = list(db.execute(statement.order_by(func.lower(Budget.name), Budget.id)).scalars())
    if not budgets:
        return []

    categories = _category_ids(db, [budget.id for budget in budgets])
    fixed = [budget for budget in budgets if not budget.carry_over]
    rolling = [budget for budget in budgets if budget.carry_over]

    bounds = {budget.id: _bounds(budget, on) for budget in fixed}
    spent_fixed = _spent_by_budget(db, user_id, fixed, bounds, categories)

    target_month = calc.first_of_month(on)
    spent_by_month = _spent_by_month(db, user_id, rolling, categories, target_month)
    # Comeca a cadeia no primeiro mes com algum gasto do orcamento; sem nenhum, nao ha o que carregar
    since_by_id = {
        budget.id: min(spent_by_month.get(budget.id, {}).keys(), default=target_month) for budget in rolling
    }

    places = _places(db, {budget.currency_code for budget in budgets})

    items = []
    for budget in fixed:
        decimals = places[budget.currency_code]
        total = quantize_money(spent_fixed.get(budget.id, ZERO), decimals)
        limit = quantize_money(budget.amount, decimals)
        start, end = bounds[budget.id]
        items.append(
            {
                **budget_output(budget, decimals, categories[budget.id]),
                "period_start": start,
                "period_end": end,
                "limit": limit,
                "spent": total,
                "remaining": limit - total,
                "percent": _percent(total, limit),
                "expired": budget.period == BudgetPeriod.custom and end < on,
            }
        )
    for budget in rolling:
        decimals = places[budget.currency_code]
        since = since_by_id[budget.id]
        figures = calc.rolling_available(budget.amount, spent_by_month.get(budget.id, {}), since, target_month)
        start, end = period_bounds(BudgetPeriod.monthly, on)
        total = quantize_money(figures.spent, decimals)
        limit = quantize_money(figures.limit, decimals)
        items.append(
            {
                **budget_output(budget, decimals, categories[budget.id]),
                "period_start": start,
                "period_end": end,
                "limit": limit,
                "spent": total,
                "remaining": quantize_money(figures.remaining, decimals),
                "percent": _percent(total, limit),
                "expired": False,
            }
        )
    order = {budget.id: index for index, budget in enumerate(budgets)}
    items.sort(key=lambda item: order[item["id"]])
    return items


# ---------- Alerta (webhook budget.alert) ----------

_RANK = {BudgetAlertLevel.none: 0, BudgetAlertLevel.warning: 1, BudgetAlertLevel.over: 2}


def _level(percent: int) -> BudgetAlertLevel:
    if percent >= 100:
        return BudgetAlertLevel.over
    if percent >= WARNING_AT_PERCENT:
        return BudgetAlertLevel.warning
    return BudgetAlertLevel.none


def _reset_alert(db: Session, budget: Budget) -> None:
    """Marca o nivel de agora como ja conhecido, sem avisar: o alerta so fala de cruzamentos que vierem depois."""
    if not budget.alert:
        budget.alert_level, budget.alert_period_start = BudgetAlertLevel.none, None
        db.flush()
        return
    items = progress(db, budget.user_id, clock.today(), include_archived=True, only={budget.id})
    if items and not items[0]["expired"]:
        budget.alert_level = _level(items[0]["percent"])
        budget.alert_period_start = items[0]["period_start"]
    else:
        budget.alert_level, budget.alert_period_start = BudgetAlertLevel.none, None
    db.flush()


def _alert_data(item: dict, level: BudgetAlertLevel) -> dict:
    return {
        "source": "budget",
        "budget": {"id": str(item["id"]), "name": item["name"], "currency_code": item["currency_code"]},
        "level": level.value,
        "percent": item["percent"],
        "limit": str(item["limit"]),
        "spent": str(item["spent"]),
        "remaining": str(item["remaining"]),
        "period_start": item["period_start"].isoformat(),
        "period_end": item["period_end"].isoformat(),
    }


def check_alerts(db: Session, user_id: uuid.UUID) -> int:
    """Avisa (webhook budget.alert) os orcamentos com alerta que subiram de nivel no periodo de hoje: de abaixo de 80%
    para perto do limite, ou para o limite atingido. Roda dentro da transacao do lancamento que mexeu no gasto. Quando
    o gasto cai (lancamento apagado ou editado) o nivel guardado desce junto, para o proximo cruzamento avisar de novo.
    Devolve quantos avisos foram enfileirados."""
    budgets = {
        budget.id: budget
        for budget in db.execute(
            select(Budget).where(Budget.user_id == user_id, Budget.active.is_(True), Budget.alert.is_(True))
        ).scalars()
    }
    if not budgets:
        return 0
    sent = 0
    for item in progress(db, user_id, clock.today(), include_archived=False, only=set(budgets)):
        if item["expired"]:
            continue
        budget = budgets[item["id"]]
        level = _level(item["percent"])
        known = budget.alert_level if budget.alert_period_start == item["period_start"] else BudgetAlertLevel.none
        if _RANK[level] > _RANK[known]:
            sent += enqueue_event(db, user_id, "budget.alert", lambda item=item, level=level: _alert_data(item, level))
        if level != known or budget.alert_period_start != item["period_start"]:
            budget.alert_level = level
            budget.alert_period_start = item["period_start"]
    db.flush()
    return sent
