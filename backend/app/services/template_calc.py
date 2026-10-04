"""Conta dos templates de envelope, sem banco de dados: so datas e valores entram, numeros saem.

Cada tipo diz quanto distribuir a um envelope num mes. O servico compara isso com o que ja foi distribuido.
"""

from collections.abc import Sequence
from datetime import date
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal

from app.models.bill import BillFrequency
from app.services.bills import latest_index, occurrence
from app.services.envelope_calc import last_day_of_month

ZERO = Decimal("0")


def step(places: int) -> Decimal:
    """O menor valor da moeda (0.01 para 2 casas, 1 para 0)."""
    return Decimal(10) ** -places


def months_left(month: date, target_month: date) -> int:
    """Quantos meses de `month` ate `target_month`, contando os dois. Zero se a data ja passou."""
    count = (target_month.year - month.year) * 12 + target_month.month - month.month + 1
    return max(count, 0)


def by_date_amount(target: Decimal, target_month: date, month: date, carried: Decimal, places: int) -> Decimal:
    """Quanto distribuir neste mes para chegar em `target` ate `target_month`: o que falta (meta menos o que passou
    do mes anterior) dividido pelos meses que restam, arredondado para cima para a meta nao ficar curta. Zero se
    ja chegou na meta ou se a data passou."""
    left = months_left(month, target_month)
    missing = target - carried
    if left == 0 or missing <= ZERO:
        return ZERO
    return (missing / left).quantize(step(places), rounding=ROUND_CEILING)


def due_dates_in_month(first_due: date, frequency: BillFrequency, month: date) -> list[date]:
    """Os vencimentos de uma conta a pagar que caem no mes de `month` (primeiro dia do mes)."""
    end = last_day_of_month(month)
    index = latest_index(first_due, frequency, end)
    found: list[date] = []
    while index is not None and index >= 0:
        day = occurrence(first_due, frequency, index)
        if day < month:
            break
        found.append(day)
        index -= 1
    return sorted(found)


def bill_amount(amount_max: Decimal, first_due: date, frequency: BillFrequency, month: date) -> Decimal:
    """O maximo da faixa da conta vezes quantos vencimentos ela tem no mes (zero se nao vence)."""
    return amount_max * len(due_dates_in_month(first_due, frequency, month))


def split_remainder(left: Decimal, count: int, places: int) -> Decimal:
    """A parte de cada envelope "o que sobrar": o que restou do A orcar dividido igualmente, arredondado para
    baixo (nunca distribui mais do que sobrou). Zero se nao sobrou nada ou nao ha envelopes."""
    if count <= 0 or left <= ZERO:
        return ZERO
    return (left / count).quantize(step(places), rounding=ROUND_FLOOR)


def goal_state(allocated: Decimal, wanted: Decimal) -> str | None:
    """Se o que foi distribuido bate com o template: "met" (chegou), "partial" (metade ou mais) ou "short".
    None quando o template nao pede nada neste mes."""
    if wanted <= ZERO:
        return None
    if allocated >= wanted:
        return "met"
    return "partial" if allocated * 2 >= wanted else "short"


def total(values: Sequence[Decimal]) -> Decimal:
    return sum(values, ZERO)
