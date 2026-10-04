"""Conta dos envelopes, sem banco de dados: so datas e valores entram, numeros saem.

Regra (a do Actual Budget): em cada mes o envelope tem o que sobrou do mes anterior, mais o que a pessoa
distribuiu, menos o que gastou. Se sobrou, passa para o mes seguinte. Se faltou, o envelope volta a zero e o
excesso sai do "A orcar" (que e o dinheiro nas contas menos o que ja esta nos envelopes).
"""

import calendar
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

ZERO = Decimal("0")


@dataclass(frozen=True)
class MonthFigures:
    # O que passou do mes anterior (nunca negativo)
    carried: Decimal
    # O que a pessoa distribuiu neste mes (pode ser negativo: tirou do que passou)
    allocated: Decimal
    # Quanto gastou neste mes
    spent: Decimal
    # carried + allocated - spent. Negativo = estourou
    available: Decimal

    @property
    def overspent(self) -> Decimal:
        """Quanto estourou (positivo), ou zero."""
        return -self.available if self.available < ZERO else ZERO

    @property
    def in_envelope(self) -> Decimal:
        """O que de fato esta guardado no envelope no fim do mes: o saldo, e nunca menos que zero."""
        return self.available if self.available > ZERO else ZERO


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


def envelope_month(allocations: Mapping[date, Decimal], spent: Mapping[date, Decimal], target: date) -> MonthFigures:
    """Os numeros do envelope no mes `target` (primeiro dia do mes).

    `allocations` e `spent` tem uma entrada por mes (primeiro dia do mes) so onde houve movimento. A conta comeca no
    primeiro mes com movimento; antes disso o envelope nao existia e tudo e zero."""
    months = [*allocations.keys(), *spent.keys()]
    if not months or min(months) > target:
        return MonthFigures(ZERO, ZERO, ZERO, ZERO)

    previous = ZERO
    figures = MonthFigures(ZERO, ZERO, ZERO, ZERO)
    for month in months_between(min(months), target):
        carried = previous if previous > ZERO else ZERO
        allocated = allocations.get(month, ZERO)
        gone = spent.get(month, ZERO)
        figures = MonthFigures(carried, allocated, gone, carried + allocated - gone)
        previous = figures.available
    return figures


def to_budget(money: Decimal, figures: Iterable[MonthFigures]) -> Decimal:
    """O "A orcar": o dinheiro disponivel menos o que esta guardado nos envelopes. Negativo quando a pessoa
    distribuiu mais do que tem (ou quando um estouro comeu o que sobrava)."""
    return money - sum((item.in_envelope for item in figures), ZERO)
