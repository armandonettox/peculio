import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.account import USER_ACCOUNT_TYPES, Account, AccountType
from app.models.currency import Currency
from app.services.accounts import quantize_money
from app.services.ledger import monthly_changes

ZERO = Decimal("0")


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
