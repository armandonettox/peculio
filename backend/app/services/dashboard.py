import calendar
import uuid
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.account import USER_ACCOUNT_TYPES, Account, AccountType
from app.models.currency import Currency
from app.models.recurrence import Recurrence
from app.models.transaction import TransactionType
from app.schemas.transaction import TransactionCreate
from app.services import recurrences
from app.services.accounts import quantize_money
from app.services.ledger import monthly_changes

ZERO = Decimal("0")
MAX_UPCOMING_ITEMS = 50

# Tipo do primeiro lancamento do modelo da recorrente -> sentido do dinheiro
DIRECTION = {
    TransactionType.withdrawal: "out",
    TransactionType.deposit: "in",
    TransactionType.transfer: "transfer",
}


def _places(db: Session, codes: set[str]) -> dict[str, int]:
    if not codes:
        return {}
    return dict(db.execute(select(Currency.code, Currency.decimal_places).where(Currency.code.in_(codes))).all())


# ---------- Patrimonio ----------


def _month_index(day: date) -> int:
    return day.year * 12 + day.month - 1


def _month_label(index: int) -> str:
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def _occurrences_in_month(rec: Recurrence, year: int, month: int) -> int:
    """Quantas ocorrencias da recorrencia `rec` caem no mes `year`-`month`."""
    first_day = date(year, month, 1)
    last_day = date(year, month, calendar.monthrange(year, month)[1])
    start_index = recurrences.latest_index(rec.first_date, rec.frequency, first_day - timedelta(days=1))
    start = 0 if start_index is None else start_index + 1
    count = 0
    for i in range(start, start + 400):
        day = recurrences.occurrence(rec.first_date, rec.frequency, i)
        if day > last_day:
            break
        if day >= first_day:
            count += 1
        if rec.max_occurrences and i + 1 >= rec.max_occurrences:
            break
        if rec.end_date and day >= rec.end_date:
            break
    return count


def _net_worth_forecast(
    db: Session,
    user_id: uuid.UUID,
    forecast_months: int,
    as_of: date,
    accounts: list[Account],
    account_balances: dict[uuid.UUID, Decimal],
    places: dict[str, int],
) -> dict[str, list[dict]]:
    """Projeta forecast_months meses futuros com base nas recorrencias auto_create ativas."""
    account_map = {acc.id: acc for acc in accounts}
    active_recs = list(
        db.execute(
            select(Recurrence).where(
                Recurrence.user_id == user_id,
                Recurrence.auto_create.is_(True),
                Recurrence.active.is_(True),
            )
        ).scalars()
    )

    last = _month_index(as_of)
    balances = dict(account_balances)
    result: dict[str, list[dict]] = {acc.currency_code: [] for acc in accounts}

    for offset in range(1, forecast_months + 1):
        idx = last + offset
        year, month = idx // 12, idx % 12 + 1

        for rec in active_recs:
            if rec.first_date > date(year, month, calendar.monthrange(year, month)[1]):
                continue
            count = _occurrences_in_month(rec, year, month)
            if count == 0:
                continue
            try:
                template = TransactionCreate.model_validate(rec.template)
            except ValidationError:
                continue
            for split in template.splits:
                acc = account_map.get(split.account_id)
                if acc is None or acc.currency_code != split.currency_code:
                    continue
                signed = split.amount * count
                if split.type == "withdrawal":
                    balances[acc.id] = balances.get(acc.id, ZERO) - signed
                elif split.type == "deposit":
                    balances[acc.id] = balances.get(acc.id, ZERO) + signed

        for code in result:
            decimals = places.get(code, 2)
            point_assets = sum(
                (balances.get(acc.id, ZERO) for acc in accounts if acc.currency_code == code and acc.type == AccountType.asset),
                ZERO,
            )
            point_liabilities = sum(
                (balances.get(acc.id, ZERO) for acc in accounts if acc.currency_code == code and acc.type == AccountType.liability),
                ZERO,
            )
            result[code].append(
                {
                    "month": _month_label(idx),
                    "assets": quantize_money(point_assets, decimals),
                    "liabilities": quantize_money(point_liabilities, decimals),
                    "net": quantize_money(point_assets + point_liabilities, decimals),
                    "forecast": True,
                }
            )
    return result


def net_worth(db: Session, user_id: uuid.UUID, months: int, as_of: date, forecast_months: int = 0) -> dict:
    """Patrimonio por moeda: saldo de cada conta de ativo e passivo (arquivadas incluidas) no fim de
    cada um dos ultimos `months` meses. O mes de `as_of` fecha em `as_of`; o que e depois dele nao conta.

    O numero de consultas e fixo: os movimentos saem agrupados por conta e mes e os saldos sao
    acumulados aqui, em Python."""
    accounts = list(
        db.execute(select(Account).where(Account.user_id == user_id, Account.type.in_(USER_ACCOUNT_TYPES))).scalars()
    )
    if not accounts:
        return {"as_of": as_of, "months": months, "currencies": []}

    changes = monthly_changes(db, [account.id for account in accounts], as_of)
    last = _month_index(as_of)
    first = last - months + 1

    # Por moeda e por mes da janela: soma dos saldos dos ativos e dos passivos
    assets: dict[str, dict[int, Decimal]] = defaultdict(lambda: defaultdict(lambda: ZERO))
    liabilities: dict[str, dict[int, Decimal]] = defaultdict(lambda: defaultdict(lambda: ZERO))
    account_balances: dict[uuid.UUID, Decimal] = {}
    for account in accounts:
        by_month = {y * 12 + m - 1: value for (y, m), value in changes[account.id].items()}
        # O que aconteceu antes da janela entra no saldo de partida
        balance = sum((value for index, value in by_month.items() if index < first), ZERO)
        target = assets if account.type == AccountType.asset else liabilities
        # Garante a moeda mesmo quando so existe conta de um dos tipos
        assets[account.currency_code]
        liabilities[account.currency_code]
        for index in range(first, last + 1):
            balance += by_month.get(index, ZERO)
            target[account.currency_code][index] += balance
        account_balances[account.id] = balance

    places = _places(db, set(assets))
    forecast_series = (
        _net_worth_forecast(db, user_id, forecast_months, as_of, accounts, account_balances, places)
        if forecast_months > 0
        else {}
    )

    currencies = []
    for code in sorted(assets):
        decimals = places[code]
        series = []
        for index in range(first, last + 1):
            point_assets = assets[code][index]
            point_liabilities = liabilities[code][index]
            series.append(
                {
                    "month": _month_label(index),
                    "assets": quantize_money(point_assets, decimals),
                    "liabilities": quantize_money(point_liabilities, decimals),
                    "net": quantize_money(point_assets + point_liabilities, decimals),
                    "forecast": False,
                }
            )
        series.extend(forecast_series.get(code, []))
        today_point = series[months - 1]
        currencies.append(
            {
                "currency_code": code,
                "assets": today_point["assets"],
                "liabilities": today_point["liabilities"],
                "net": today_point["net"],
                "series": series,
            }
        )
    return {"as_of": as_of, "months": months, "currencies": currencies}


# ---------- Previsao de gastos ----------


def spending_forecast(db: Session, user_id: uuid.UUID, months: int, as_of: date) -> dict:
    """Projeta receitas e despesas dos proximos `months` meses com base nas recorrencias auto_create ativas.

    Withdrawal -> despesa; deposit -> receita. Transfers sao ignorados (nao mudam o resultado liquido do usuario).
    O agrupamento e por moeda do primeiro split de cada recorrente."""
    active_recs = list(
        db.execute(
            select(Recurrence).where(
                Recurrence.user_id == user_id,
                Recurrence.auto_create.is_(True),
                Recurrence.active.is_(True),
            )
        ).scalars()
    )

    last = _month_index(as_of)
    # income[code][month_index] e expense[code][month_index]
    income: dict[str, dict[int, Decimal]] = defaultdict(lambda: defaultdict(lambda: ZERO))
    expense: dict[str, dict[int, Decimal]] = defaultdict(lambda: defaultdict(lambda: ZERO))

    for rec in active_recs:
        try:
            template = TransactionCreate.model_validate(rec.template)
        except ValidationError:
            continue
        for offset in range(1, months + 1):
            idx = last + offset
            year, month = idx // 12, idx % 12 + 1
            last_day = date(year, month, calendar.monthrange(year, month)[1])
            if rec.first_date > last_day:
                continue
            count = _occurrences_in_month(rec, year, month)
            if count == 0:
                continue
            for split in template.splits:
                code = split.currency_code
                signed = split.amount * count
                if split.type == TransactionType.withdrawal:
                    expense[code][idx] += signed
                elif split.type == TransactionType.deposit:
                    income[code][idx] += signed

    all_codes = set(income) | set(expense)
    if not all_codes:
        return {"as_of": as_of, "months": months, "currencies": []}

    places = _places(db, all_codes)
    currencies = []
    for code in sorted(all_codes):
        decimals = places.get(code, 2)
        series = []
        for offset in range(1, months + 1):
            idx = last + offset
            inc = income[code][idx]
            exp = expense[code][idx]
            series.append(
                {
                    "month": _month_label(idx),
                    "income": quantize_money(inc, decimals),
                    "expense": quantize_money(exp, decimals),
                    "net": quantize_money(inc - exp, decimals),
                }
            )
        currencies.append({"currency_code": code, "series": series})
    return {"as_of": as_of, "months": months, "currencies": currencies}


# ---------- Proximos vencimentos ----------


def _bill_items(db: Session, user_id: uuid.UUID, as_of: date, limit: date) -> list[dict]:
    """Uma entrada por conta a pagar ativa: a atrasada (ultimo vencimento sem pagamento) tem
    prioridade; senao o proximo vencimento, se cair na janela e ainda nao estiver pago."""
    items = []
    for bill in recurrences.status(db, user_id, as_of, include_archived=False):
        last_due = bill["last_due_date"]
        if bill["status"] == "overdue":
            # Vencida hoje e ainda nao paga: o dia nao acabou, entao nao e atraso
            day = last_due
        elif bill["next_due_date"] <= limit and not bill["next_due_paid"]:
            day = bill["next_due_date"]
        else:
            continue
        items.append(
            {
                "kind": "bill",
                "id": bill["id"],
                "name": bill["name"],
                "date": day,
                "days_until": (day - as_of).days,
                "overdue": day < as_of,
                "direction": "out",
                "currency_code": bill["currency_code"],
                "amount_min": bill["amount_min"],
                "amount_max": bill["amount_max"],
            }
        )
    return items


def _recurrence_items(db: Session, user_id: uuid.UUID, as_of: date, limit: date) -> list[dict]:
    found = []
    statement = select(Recurrence).where(Recurrence.user_id == user_id, Recurrence.auto_create.is_(True))
    for recurrence in db.execute(statement).scalars():
        day = recurrences.upcoming_date(recurrence)
        if day is None or day < as_of or day > limit:
            continue
        try:
            template = TransactionCreate.model_validate(recurrence.template)
        except ValidationError:
            # Modelo estragado nao derruba o painel; o erro aparece na propria recorrente
            continue
        first = template.splits[0]
        total = sum((split.amount for split in template.splits if split.currency_code == first.currency_code), ZERO)
        found.append((recurrence, day, first, total))

    places = _places(db, {first.currency_code for _, _, first, _ in found})
    items = []
    for recurrence, day, first, total in found:
        amount = quantize_money(total, places[first.currency_code])
        items.append(
            {
                "kind": "recurrence",
                "id": recurrence.id,
                "name": recurrence.name,
                "date": day,
                "days_until": (day - as_of).days,
                "overdue": False,
                "direction": DIRECTION[first.type],
                "currency_code": first.currency_code,
                "amount_min": amount,
                "amount_max": amount,
            }
        )
    return items


def upcoming(db: Session, user_id: uuid.UUID, days: int, as_of: date) -> dict:
    """Contas a pagar e recorrentes de hoje ate hoje + `days`, mais as contas a pagar atrasadas.
    Atrasadas primeiro (da mais antiga), depois por data e por nome, no maximo 50."""
    limit = as_of + timedelta(days=days)
    items = _bill_items(db, user_id, as_of, limit) + _recurrence_items(db, user_id, as_of, limit)
    items.sort(key=lambda item: (not item["overdue"], item["date"], item["name"].lower(), str(item["id"])))
    return {"as_of": as_of, "days": days, "items": items[:MAX_UPCOMING_ITEMS]}
