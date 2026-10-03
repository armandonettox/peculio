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
from app.services import bills, recurrences
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


def net_worth(db: Session, user_id: uuid.UUID, months: int, as_of: date) -> dict:
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

    places = _places(db, set(assets))
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
                }
            )
        today_point = series[-1]
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


# ---------- Proximos vencimentos ----------


def _bill_items(db: Session, user_id: uuid.UUID, as_of: date, limit: date) -> list[dict]:
    """Uma entrada por conta a pagar ativa: a atrasada (ultimo vencimento sem pagamento) tem
    prioridade; senao o proximo vencimento, se cair na janela e ainda nao estiver pago."""
    items = []
    for bill in bills.status(db, user_id, as_of, include_archived=False):
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
    for recurrence in db.execute(select(Recurrence).where(Recurrence.user_id == user_id)).scalars():
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
