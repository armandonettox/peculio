from datetime import date, timedelta

import pytest

from app.models.recurrence import RecurrenceFrequency
from app.services.recurrences import latest_index, occurrence

F = RecurrenceFrequency


@pytest.mark.parametrize(
    ("first", "frequency", "index", "expected"),
    [
        # Mensal: o dia 31 vence no ultimo dia dos meses curtos e volta ao 31 quando o mes tem
        (date(2026, 1, 31), F.monthly, 0, date(2026, 1, 31)),
        (date(2026, 1, 31), F.monthly, 1, date(2026, 2, 28)),
        (date(2026, 1, 31), F.monthly, 2, date(2026, 3, 31)),
        (date(2026, 1, 31), F.monthly, 3, date(2026, 4, 30)),
        (date(2027, 1, 31), F.monthly, 1, date(2027, 2, 28)),
        (date(2028, 1, 31), F.monthly, 1, date(2028, 2, 29)),
        (date(2026, 11, 15), F.monthly, 2, date(2027, 1, 15)),
        (date(2026, 12, 10), F.monthly, 14, date(2028, 2, 10)),
        # Semanal
        (date(2026, 3, 5), F.weekly, 0, date(2026, 3, 5)),
        (date(2026, 3, 5), F.weekly, 1, date(2026, 3, 12)),
        (date(2026, 12, 28), F.weekly, 1, date(2027, 1, 4)),
        # Trimestral, semestral e anual
        (date(2026, 1, 15), F.quarterly, 1, date(2026, 4, 15)),
        (date(2026, 1, 15), F.quarterly, 4, date(2027, 1, 15)),
        (date(2026, 3, 31), F.quarterly, 1, date(2026, 6, 30)),
        (date(2026, 8, 31), F.half_yearly, 1, date(2027, 2, 28)),
        (date(2026, 8, 31), F.half_yearly, 2, date(2027, 8, 31)),
        (date(2028, 2, 29), F.yearly, 1, date(2029, 2, 28)),
        (date(2028, 2, 29), F.yearly, 4, date(2032, 2, 29)),
        (date(2026, 7, 4), F.yearly, 3, date(2029, 7, 4)),
    ],
)
def test_occurrence(first, frequency, index, expected):
    assert occurrence(first, frequency, index) == expected


@pytest.mark.parametrize(
    ("first", "frequency", "on", "expected"),
    [
        # Antes do primeiro vencimento nao ha ultimo
        (date(2026, 3, 5), F.monthly, date(2026, 3, 4), None),
        (date(2026, 3, 5), F.monthly, date(2025, 1, 1), None),
        # No dia do vencimento ele ja conta como o ultimo
        (date(2026, 3, 5), F.monthly, date(2026, 3, 5), 0),
        (date(2026, 3, 5), F.monthly, date(2026, 4, 4), 0),
        (date(2026, 3, 5), F.monthly, date(2026, 4, 5), 1),
        (date(2026, 3, 5), F.monthly, date(2027, 3, 4), 11),
        (date(2026, 3, 5), F.monthly, date(2027, 3, 5), 12),
        # Dia 31: o vencimento de fevereiro e dia 28
        (date(2026, 1, 31), F.monthly, date(2026, 2, 27), 0),
        (date(2026, 1, 31), F.monthly, date(2026, 2, 28), 1),
        (date(2026, 1, 31), F.monthly, date(2026, 3, 30), 1),
        (date(2026, 1, 31), F.monthly, date(2026, 3, 31), 2),
        # Semanal
        (date(2026, 3, 5), F.weekly, date(2026, 3, 11), 0),
        (date(2026, 3, 5), F.weekly, date(2026, 3, 12), 1),
        (date(2026, 3, 5), F.weekly, date(2026, 4, 1), 3),
        (date(2026, 3, 5), F.weekly, date(2026, 4, 2), 4),
        # Trimestral, semestral e anual
        (date(2026, 1, 15), F.quarterly, date(2026, 4, 14), 0),
        (date(2026, 1, 15), F.quarterly, date(2026, 4, 15), 1),
        (date(2026, 1, 15), F.half_yearly, date(2026, 7, 14), 0),
        (date(2026, 1, 15), F.half_yearly, date(2027, 1, 15), 2),
        (date(2026, 1, 15), F.yearly, date(2027, 1, 14), 0),
        (date(2028, 2, 29), F.yearly, date(2029, 2, 27), 0),
        (date(2028, 2, 29), F.yearly, date(2029, 2, 28), 1),
    ],
)
def test_latest_index(first, frequency, on, expected):
    assert latest_index(first, frequency, on) == expected


@pytest.mark.parametrize("frequency", list(F))
@pytest.mark.parametrize("first", [date(2026, 1, 31), date(2026, 3, 5), date(2028, 2, 29), date(2026, 12, 1)])
def test_latest_index_is_the_last_occurrence_not_after_the_date(first, frequency):
    for offset in range(0, 800, 3):
        on = first + timedelta(days=offset)
        index = latest_index(first, frequency, on)
        assert occurrence(first, frequency, index) <= on
        assert occurrence(first, frequency, index + 1) > on
