import calendar
import datetime as dt
import re
import uuid
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.core import clock
from app.core.errors import AppError, ErrorCode
from app.models.account import Account, AccountRole, AccountType
from app.models.budget import BudgetAlertLevel
from app.models.category import Category, CategoryKind
from app.models.currency import Currency
from app.models.monthly_plan import CardCounting, MonthlyPlan, MonthlyPlanItem
from app.models.transaction import TransactionSplit, TransactionType
from app.models.user import User
from app.schemas.monthly_plan import MonthlyPlanCreate, MonthlyPlanUpdate, PlanItemIn
from app.services.accounts import get_currency, quantize_money
from app.services.invoices import due_date_for, period_for
from app.services.transactions import get_owned_category
from app.services.webhooks import enqueue_event

ZERO = Decimal("0")
HUNDRED = Decimal("100")
# A partir de quanto do limite a linha passa a avisar que esta perto
NEAR_RATIO = Decimal("0.8")
# Uma fatura vence no maximo ~2 meses depois da compra que ela contem: janela de busca no modo "pela fatura"
INVOICE_LOOKBACK_DAYS = 75

MONTH_PATTERN = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


# ---------- Mes ----------


def parse_month(text: str) -> dt.date:
    """'2026-11' vira 2026-11-01. 422 se nao for um mes."""
    match = MONTH_PATTERN.match(text)
    if not match:
        raise AppError(422, ErrorCode.VALIDATION_ERROR, "Informe o mes no formato AAAA-MM")
    return dt.date(int(match.group(1)), int(match.group(2)), 1)


def month_bounds(month: dt.date) -> tuple[dt.date, dt.date]:
    return month, dt.date(month.year, month.month, calendar.monthrange(month.year, month.month)[1])


def previous_month(month: dt.date) -> dt.date:
    return dt.date(month.year - 1, 12, 1) if month.month == 1 else dt.date(month.year, month.month - 1, 1)


# ---------- Busca ----------


def get_plan(db: Session, user_id: uuid.UUID, month: dt.date) -> MonthlyPlan | None:
    return db.execute(
        select(MonthlyPlan).where(MonthlyPlan.user_id == user_id, MonthlyPlan.month == month)
    ).scalar_one_or_none()


def require_plan(db: Session, user_id: uuid.UUID, month: dt.date) -> MonthlyPlan:
    plan = get_plan(db, user_id, month)
    if not plan:
        raise AppError(404, ErrorCode.MONTHLY_PLAN_NOT_FOUND, "Nao ha planejamento para este mes")
    return plan


def _items(db: Session, plan: MonthlyPlan) -> list[MonthlyPlanItem]:
    return list(db.execute(select(MonthlyPlanItem).where(MonthlyPlanItem.plan_id == plan.id)).scalars())


def _places(db: Session, currency_code: str) -> int:
    return db.scalar(select(Currency.decimal_places).where(Currency.code == currency_code)) or 0


def spending_budget(plan: MonthlyPlan, places: int) -> Decimal:
    """O que pode ser gasto no mes: a renda menos a parte que a pessoa quer economizar."""
    return quantize_money(plan.income * (HUNDRED - plan.savings_percent) / HUNDRED, places)


# ---------- Validacao dos limites ----------


def _check_categories(db: Session, user_id: uuid.UUID, items: list[PlanItemIn]) -> None:
    for item in items:
        category = get_owned_category(db, user_id, item.category_id)
        if category.kind != CategoryKind.expense:
            raise AppError(
                400,
                ErrorCode.CATEGORY_KIND_MISMATCH,
                "Planejamento so tem categorias de saida: escolha uma categoria de gasto",
            )


def _check_budget(plan: MonthlyPlan, places: int, amounts: list[Decimal]) -> None:
    if sum(amounts, ZERO) > spending_budget(plan, places):
        raise AppError(
            400,
            ErrorCode.PLAN_ITEMS_EXCEED_BUDGET,
            "A soma dos limites passa do orcamento de gastos do mes",
        )


# ---------- Escrita ----------


def create_plan(db: Session, user: User, month: dt.date, data: MonthlyPlanCreate) -> MonthlyPlan:
    if get_plan(db, user.id, month):
        raise AppError(409, ErrorCode.MONTHLY_PLAN_EXISTS, "Ja existe um planejamento para este mes")
    currency = get_currency(db, data.currency_code or user.default_currency)
    _check_categories(db, user.id, data.items)
    plan = MonthlyPlan(
        user_id=user.id,
        month=month,
        currency_code=currency.code,
        income=data.income,
        savings_percent=data.savings_percent,
        card_counting=data.card_counting,
    )
    _check_budget(plan, currency.decimal_places, [item.amount for item in data.items])
    db.add(plan)
    db.flush()
    for item in data.items:
        db.add(MonthlyPlanItem(plan_id=plan.id, category_id=item.category_id, amount=item.amount, alert=item.alert))
    db.flush()
    _reset_alerts(db, user.id, plan)
    return plan


def update_plan(db: Session, plan: MonthlyPlan, data: MonthlyPlanUpdate) -> MonthlyPlan:
    changes = data.model_dump(exclude_unset=True)
    # Omitir o campo nao mexe nele; mandar null nao tem o que limpar
    for field, value in changes.items():
        if value is not None:
            setattr(plan, field, value)
    places = _places(db, plan.currency_code)
    _check_budget(plan, places, [item.amount for item in _items(db, plan)])
    db.flush()
    return plan


def upsert_items(db: Session, user: User, plan: MonthlyPlan, incoming: list[PlanItemIn]) -> None:
    _check_categories(db, user.id, incoming)
    existing = {item.category_id: item for item in _items(db, plan)}
    for item in incoming:
        if item.category_id in existing:
            existing[item.category_id].amount = item.amount
            existing[item.category_id].alert = item.alert
        else:
            created = MonthlyPlanItem(plan_id=plan.id, category_id=item.category_id, amount=item.amount, alert=item.alert)
            db.add(created)
            existing[item.category_id] = created
    _check_budget(plan, _places(db, plan.currency_code), [item.amount for item in existing.values()])
    db.flush()
    _reset_alerts(db, user.id, plan)


def delete_item(db: Session, plan: MonthlyPlan, category_id: uuid.UUID) -> None:
    item = db.execute(
        select(MonthlyPlanItem).where(MonthlyPlanItem.plan_id == plan.id, MonthlyPlanItem.category_id == category_id)
    ).scalar_one_or_none()
    if not item:
        raise AppError(404, ErrorCode.PLAN_ITEM_NOT_FOUND, "Esta categoria nao tem limite neste planejamento")
    db.delete(item)
    db.flush()


def copy_previous(db: Session, user: User, month: dt.date) -> MonthlyPlan:
    """Copia o planejamento do mes anterior (renda, economia, forma de contar o cartao e os limites) para o mes."""
    if get_plan(db, user.id, month):
        raise AppError(409, ErrorCode.MONTHLY_PLAN_EXISTS, "Ja existe um planejamento para este mes")
    source = require_plan(db, user.id, previous_month(month))
    copy = MonthlyPlan(
        user_id=user.id,
        month=month,
        currency_code=source.currency_code,
        income=source.income,
        savings_percent=source.savings_percent,
        card_counting=source.card_counting,
    )
    db.add(copy)
    db.flush()
    for item in _items(db, source):
        db.add(MonthlyPlanItem(plan_id=copy.id, category_id=item.category_id, amount=item.amount, alert=item.alert))
    db.flush()
    _reset_alerts(db, user.id, copy)
    return copy


def delete_plan(db: Session, plan: MonthlyPlan) -> None:
    db.delete(plan)
    db.flush()


def delete_all_plans(db: Session, user_id: uuid.UUID) -> int:
    plans = list(db.execute(select(MonthlyPlan).where(MonthlyPlan.user_id == user_id)).scalars())
    for plan in plans:
        db.delete(plan)
    db.flush()
    return len(plans)


# ---------- Leitura: o que foi gasto ----------


def _spent_by_category(db: Session, user_id: uuid.UUID, plan: MonthlyPlan) -> dict[uuid.UUID | None, list[Decimal]]:
    """Gasto do mes por categoria, como [pago, previsto]. So saida para uma conta de despesa, na moeda do plano, sem os
    lancamentos ignorados. No modo "pela fatura" a compra no cartao conta no mes do vencimento da fatura dela."""
    start, end = month_bounds(plan.month)
    invoice_mode = plan.card_counting == CardCounting.invoice
    source = aliased(Account)
    destination = aliased(Account)
    effective = func.coalesce(TransactionSplit.invoice_date, TransactionSplit.date)

    # Modo pela fatura: a data que decide o mes e a da fatura, que pode ser anterior ao mes (compra feita antes de fechar)
    date_filter = (
        (effective >= start - dt.timedelta(days=INVOICE_LOOKBACK_DAYS)) & (effective <= end)
        if invoice_mode
        else (TransactionSplit.date >= start) & (TransactionSplit.date <= end)
    )
    rows = db.execute(
        select(
            TransactionSplit.category_id,
            TransactionSplit.amount,
            TransactionSplit.is_paid,
            TransactionSplit.date,
            TransactionSplit.invoice_date,
            source.role,
            source.closing_day,
            source.due_day,
        )
        .join(source, source.id == TransactionSplit.source_account_id)
        .join(destination, destination.id == TransactionSplit.destination_account_id)
        .where(
            TransactionSplit.user_id == user_id,
            TransactionSplit.type == TransactionType.withdrawal,
            TransactionSplit.ignored.is_(False),
            TransactionSplit.currency_code == plan.currency_code,
            destination.type == AccountType.expense,
            date_filter,
        )
    ).all()

    spent: dict[uuid.UUID | None, list[Decimal]] = defaultdict(lambda: [ZERO, ZERO])
    for category_id, amount, is_paid, day, invoice_date, role, closing_day, due_day in rows:
        counted_on = day
        if invoice_mode and role == AccountRole.credit_card and closing_day and due_day:
            _, period_end = period_for(invoice_date or day, closing_day)
            counted_on = due_date_for(period_end, due_day)
        if not (start <= counted_on <= end):
            continue
        spent[category_id][0 if is_paid else 1] += amount
    return spent


def _month_income(db: Session, user_id: uuid.UUID, plan: MonthlyPlan) -> Decimal:
    start, end = month_bounds(plan.month)
    source = aliased(Account)
    total = db.scalar(
        select(func.coalesce(func.sum(TransactionSplit.amount), 0))
        .join(source, source.id == TransactionSplit.source_account_id)
        .where(
            TransactionSplit.user_id == user_id,
            TransactionSplit.type == TransactionType.deposit,
            TransactionSplit.ignored.is_(False),
            TransactionSplit.currency_code == plan.currency_code,
            source.type == AccountType.revenue,
            TransactionSplit.date >= start,
            TransactionSplit.date <= end,
        )
    )
    return Decimal(total)


def _state(limit: Decimal, total: Decimal) -> str:
    if total > limit:
        return "exceeded"
    if limit > 0 and total >= limit * NEAR_RATIO:
        return "near"
    return "ok"


def build_output(db: Session, user_id: uuid.UUID, plan: MonthlyPlan) -> dict:
    places = _places(db, plan.currency_code)
    q = lambda value: quantize_money(value, places)  # noqa: E731
    budget = spending_budget(plan, places)
    items = _items(db, plan)
    categories = {
        category.id: category
        for category in db.execute(
            select(Category).where(Category.id.in_([item.category_id for item in items]))
        ).scalars()
    }
    spent = _spent_by_category(db, user_id, plan)

    rows = []
    limited = set()
    for item in sorted(items, key=lambda i: categories[i.category_id].name.lower()):
        category = categories[item.category_id]
        limited.add(item.category_id)
        paid, expected = spent.get(item.category_id, [ZERO, ZERO])
        total = paid + expected
        rows.append(
            {
                "category_id": category.id,
                "category_name": category.name,
                "category_color": category.color,
                "category_icon": category.icon,
                "kind": "category",
                "planned": q(item.amount),
                "paid": q(paid),
                "expected": q(expected),
                "total": q(total),
                "remaining": q(item.amount - total),
                "alert": item.alert,
                "state": _state(item.amount, total),
            }
        )

    # Categorias restantes: o que sobrou do orcamento e tudo o que se gastou fora das categorias com limite
    rest_planned = budget - sum((item.amount for item in items), ZERO)
    rest_paid = sum((v[0] for k, v in spent.items() if k not in limited), ZERO)
    rest_expected = sum((v[1] for k, v in spent.items() if k not in limited), ZERO)
    rest_total = rest_paid + rest_expected
    rows.append(
        {
            "category_id": None,
            "category_name": None,
            "category_color": None,
            "category_icon": None,
            "kind": "rest",
            "planned": q(rest_planned),
            "paid": q(rest_paid),
            "expected": q(rest_expected),
            "total": q(rest_total),
            "remaining": q(rest_planned - rest_total),
            "alert": False,
            "state": _state(rest_planned, rest_total),
        }
    )

    paid_all = sum((v[0] for v in spent.values()), ZERO)
    expected_all = sum((v[1] for v in spent.values()), ZERO)
    income = _month_income(db, user_id, plan)
    balance = income - budget
    return {
        "month": plan.month,
        "currency_code": plan.currency_code,
        "income": q(plan.income),
        "savings_percent": plan.savings_percent,
        "card_counting": plan.card_counting,
        "spending_budget": budget,
        "savings_amount": q(plan.income - budget),
        "summary": {
            "month_income": q(income),
            "planned_spending": budget,
            "planned_balance": q(balance),
            "planned_savings_percent": (balance / income * HUNDRED).quantize(Decimal("0.01")) if income > 0 else Decimal("0.00"),
            "spent_paid": q(paid_all),
            "spent_expected": q(expected_all),
            "spent_total": q(paid_all + expected_all),
            "remaining": q(budget - paid_all - expected_all),
        },
        "rows": rows,
    }


# ---------- Alerta (webhook budget.alert) ----------

_LEVEL_OF_STATE = {"ok": BudgetAlertLevel.none, "near": BudgetAlertLevel.warning, "exceeded": BudgetAlertLevel.over}
_RANK = {BudgetAlertLevel.none: 0, BudgetAlertLevel.warning: 1, BudgetAlertLevel.over: 2}


def _item_level(item: MonthlyPlanItem, total: Decimal) -> BudgetAlertLevel:
    """O mesmo criterio do selo da tabela: perto a partir de 80% do limite, passou quando o total supera o limite."""
    return _LEVEL_OF_STATE[_state(item.amount, total)]


def _reset_alerts(db: Session, user_id: uuid.UUID, plan: MonthlyPlan) -> None:
    """Grava o nivel de agora como ja conhecido, sem avisar: o alerta so fala de cruzamentos que vierem depois. Limite
    sem alerta volta a zero."""
    items = _items(db, plan)
    with_alert = [item for item in items if item.alert]
    spent = _spent_by_category(db, user_id, plan) if with_alert else {}
    for item in items:
        if item.alert:
            paid, expected = spent.get(item.category_id, [ZERO, ZERO])
            item.alert_level = _item_level(item, paid + expected)
        else:
            item.alert_level = BudgetAlertLevel.none
    db.flush()


def check_plan_alerts(db: Session, user_id: uuid.UUID) -> int:
    """Avisa (webhook budget.alert, com source "monthly_plan") os limites com alerta do planejamento do mes de hoje que
    subiram de nivel: de abaixo de 80% para perto do limite, ou para passou do limite. Roda dentro da transacao do
    lancamento que mexeu no gasto. Se o gasto cai, o nivel guardado desce junto e o proximo cruzamento avisa de novo.
    Devolve quantos avisos foram enfileirados."""
    plan = get_plan(db, user_id, clock.today().replace(day=1))
    if not plan:
        return 0
    items = [item for item in _items(db, plan) if item.alert]
    if not items:
        return 0
    spent = _spent_by_category(db, user_id, plan)
    places = _places(db, plan.currency_code)
    categories = {
        category.id: category
        for category in db.execute(select(Category).where(Category.id.in_([item.category_id for item in items]))).scalars()
    }
    sent = 0
    for item in items:
        paid, expected = spent.get(item.category_id, [ZERO, ZERO])
        total = paid + expected
        level = _item_level(item, total)
        if _RANK[level] > _RANK[item.alert_level]:
            category = categories[item.category_id]

            def data(item=item, category=category, paid=paid, expected=expected, total=total, level=level):
                limit = item.amount
                return {
                    "source": "monthly_plan",
                    "category": {"id": str(category.id), "name": category.name},
                    "month": plan.month.isoformat(),
                    "currency_code": plan.currency_code,
                    "level": level.value,
                    "percent": int(total * 100 // limit) if limit > 0 else 0,
                    "limit": str(quantize_money(limit, places)),
                    "spent": str(quantize_money(total, places)),
                    "paid": str(quantize_money(paid, places)),
                    "expected": str(quantize_money(expected, places)),
                    "remaining": str(quantize_money(limit - total, places)),
                }

            sent += enqueue_event(db, user_id, "budget.alert", data)
        item.alert_level = level
    db.flush()
    return sent
