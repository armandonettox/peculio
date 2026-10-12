"""Conta do orcamento com sobra acumulada, sem banco de dados: so datas e valores entram, numeros saem.

Regra: todo mes tem o limite fixo (amount) mais o que sobrou (ou faltou) do mes anterior, quando o
orcamento carrega a sobra. Estourou? O mes seguinte ja nasce com o limite mais apertado, sem precisar
cobrir na mao."""

import calendar
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

ZERO = Decimal("0")


def first_of_month(day: date) -> date:
    return day.replace(day=1)


def next_month(first: date) -> date:
    """O primeiro dia do mes seguinte a `first` (que e o primeiro de um mes)."""
    return date(first.year + 1, 1, 1) if first.month == 12 else date(first.year, first.month + 1, 1)


def last_day_of_month(first: date) -> date:
    return first.replace(day=calendar.monthrange(first.year, first.month)[1])


def months_between(start: date, end: date) -> Iterable[date]:
    """Os primeiros dias de cada mes de `start` ate `end`, inclusive. Os dois sao o primeiro de um mes."""
    current = start
    while current <= end:
        yield current
        current = next_month(current)


@dataclass(frozen=True)
class MonthFigures:
    # O que veio do mes anterior (pode ser negativo: estourou e o mes nasce mais apertado)
    carried_in: Decimal
    # amount + carried_in
    limit: Decimal
    spent: Decimal
    # limit - spent. Negativo = estourou neste mes tambem
    remaining: Decimal


def rolling_available(amount: Decimal, spent_by_month: Mapping[date, Decimal], since: date, target: date) -> MonthFigures:
    """O orcamento com sobra acumulada, do mes `since` (primeiro em que o orcamento existia) ate `target`."""
    if since > target:
        return MonthFigures(ZERO, amount, ZERO, amount)

    carried = ZERO
    figures = MonthFigures(ZERO, amount, ZERO, amount)
    for month in months_between(since, target):
        limit = amount + carried
        spent = spent_by_month.get(month, ZERO)
        figures = MonthFigures(carried, limit, spent, limit - spent)
        carried = figures.remaining
    return figures
