from datetime import date, timedelta

import pytest

from app.models.recurrence import RecurrenceFrequency
from app.services.recurrences import latest_index, occurrence

F = RecurrenceFrequency


@pytest.mark.parametrize(
    ("first", "frequency", "index", "expected"),
    [
        (date(2026, 3, 5), F.daily, 0, date(2026, 3, 5)),
        (date(2026, 3, 5), F.daily, 30, date(2026, 4, 4)),
        (date(2026, 12, 30), F.daily, 3, date(2027, 1, 2)),
        (date(2028, 2, 28), F.daily, 1, date(2028, 2, 29)),
        (date(2026, 3, 5), F.weekly, 2, date(2026, 3, 19)),
        (date(2026, 1, 31), F.monthly, 1, date(2026, 2, 28)),
        (date(2026, 1, 31), F.monthly, 2, date(2026, 3, 31)),
        (date(2026, 1, 15), F.quarterly, 1, date(2026, 4, 15)),
        (date(2026, 8, 31), F.half_yearly, 1, date(2027, 2, 28)),
        (date(2028, 2, 29), F.yearly, 1, date(2029, 2, 28)),
    ],
)
def test_occurrence(first, frequency, index, expected):
    assert occurrence(first, frequency, index) == expected


@pytest.mark.parametrize(
    ("first", "frequency", "on", "expected"),
    [
        (date(2026, 3, 5), F.daily, date(2026, 3, 4), None),
        (date(2026, 3, 5), F.daily, date(2026, 3, 5), 0),
        (date(2026, 3, 5), F.daily, date(2026, 3, 15), 10),
        (date(2026, 3, 5), F.weekly, date(2026, 3, 11), 0),
        (date(2026, 3, 5), F.weekly, date(2026, 3, 12), 1),
        (date(2026, 3, 5), F.monthly, date(2026, 4, 4), 0),
        (date(2026, 3, 5), F.monthly, date(2026, 4, 5), 1),
        (date(2026, 1, 31), F.monthly, date(2026, 2, 28), 1),
    ],
)
def test_latest_index(first, frequency, on, expected):
    assert latest_index(first, frequency, on) == expected


@pytest.mark.parametrize("frequency", list(F))
@pytest.mark.parametrize("first", [date(2026, 1, 31), date(2026, 3, 5), date(2028, 2, 29)])
def test_latest_index_is_the_last_occurrence_not_after_the_date(first, frequency):
    for offset in range(0, 500, 3):
        on = first + timedelta(days=offset)
        index = latest_index(first, frequency, on)
        assert occurrence(first, frequency, index) <= on < occurrence(first, frequency, index + 1)
