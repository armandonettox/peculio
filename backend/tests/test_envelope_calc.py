from datetime import date
from decimal import Decimal

import pytest

from app.services.envelope_calc import (
    MonthFigures,
    envelope_month,
    first_of_month,
    last_day_of_month,
    months_between,
    next_month,
    to_budget,
)

D = Decimal
JAN, FEB, MAR, APR = date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1), date(2026, 4, 1)


def fig(carried, allocated, spent, available):
    return MonthFigures(D(carried), D(allocated), D(spent), D(available))


# ---------- Datas ----------


def test_first_of_month_and_next_month():
    assert first_of_month(date(2026, 3, 17)) == MAR
    assert first_of_month(MAR) == MAR
    assert next_month(JAN) == FEB
    assert next_month(date(2026, 12, 1)) == date(2027, 1, 1)
    assert next_month(date(2026, 11, 1)) == date(2026, 12, 1)


@pytest.mark.parametrize(
    "first, expected",
    [
        (date(2026, 1, 1), date(2026, 1, 31)),
        (date(2026, 2, 1), date(2026, 2, 28)),
        (date(2028, 2, 1), date(2028, 2, 29)),
        (date(2026, 4, 1), date(2026, 4, 30)),
        (date(2026, 12, 1), date(2026, 12, 31)),
    ],
)
def test_last_day_of_month(first, expected):
    assert last_day_of_month(first) == expected


def test_months_between_is_inclusive_and_crosses_years():
    assert list(months_between(date(2025, 11, 1), JAN)) == [date(2025, 11, 1), date(2025, 12, 1), JAN]
    assert list(months_between(MAR, MAR)) == [MAR]
    assert list(months_between(APR, MAR)) == []


# ---------- Envelope ----------


def test_no_movement_is_all_zero():
    assert envelope_month({}, {}, MAR) == fig(0, 0, 0, 0)


def test_before_the_first_month_with_movement_the_envelope_does_not_exist():
    assert envelope_month({MAR: D(100)}, {}, FEB) == fig(0, 0, 0, 0)
    assert envelope_month({}, {MAR: D(40)}, JAN) == fig(0, 0, 0, 0)


def test_a_single_month_is_allocated_minus_spent():
    assert envelope_month({JAN: D("100")}, {JAN: D("30")}, JAN) == fig(0, 100, 30, 70)


def test_what_is_left_carries_to_the_next_month():
    figures = envelope_month({JAN: D(100), FEB: D(50)}, {JAN: D(30)}, FEB)
    assert figures == fig(70, 50, 0, 120)


def test_months_without_movement_keep_carrying():
    assert envelope_month({JAN: D(100)}, {}, APR) == fig(100, 0, 0, 100)


def test_spending_in_a_later_month_uses_what_carried():
    assert envelope_month({JAN: D(100)}, {MAR: D(40)}, MAR) == fig(100, 0, 40, 60)


def test_overspending_leaves_the_envelope_negative_in_that_month():
    figures = envelope_month({JAN: D(100)}, {JAN: D(130)}, JAN)
    assert figures == fig(0, 100, 130, -30)
    assert figures.overspent == D(30)
    assert figures.in_envelope == D(0)


def test_an_overspent_envelope_restarts_from_zero_next_month_not_negative():
    # O excesso sai do "A orcar", nao fica devendo dentro do envelope
    assert envelope_month({JAN: D(100), FEB: D(50)}, {JAN: D(130)}, FEB) == fig(0, 50, 0, 50)


def test_spending_with_no_allocation_is_overspending():
    figures = envelope_month({}, {JAN: D(40)}, JAN)
    assert figures == fig(0, 0, 40, -40) and figures.overspent == D(40)


def test_a_negative_allocation_takes_from_what_carried():
    assert envelope_month({JAN: D(100), FEB: D(-60)}, {}, FEB) == fig(100, -60, 0, 40)


def test_allocation_that_exactly_covers_the_spending_leaves_zero_and_no_overspending():
    figures = envelope_month({JAN: D(80)}, {JAN: D(80)}, JAN)
    assert figures == fig(0, 80, 80, 0)
    assert figures.overspent == D(0) and figures.in_envelope == D(0)


def test_it_carries_across_the_year_boundary():
    december = date(2025, 12, 1)
    assert envelope_month({december: D(100)}, {december: D(25)}, JAN) == fig(75, 0, 0, 75)


def test_movement_after_the_target_month_is_ignored():
    assert envelope_month({JAN: D(100), MAR: D(900)}, {APR: D(500)}, FEB) == fig(100, 0, 0, 100)


def test_cents_add_up_exactly():
    figures = envelope_month({JAN: D("0.10"), FEB: D("0.20")}, {JAN: D("0.05")}, FEB)
    assert figures.available == D("0.25")


def test_a_big_gap_still_works():
    far = date(2036, 1, 1)
    assert envelope_month({JAN: D(10)}, {}, far) == fig(10, 0, 0, 10)


def test_in_envelope_and_overspent_properties():
    assert fig(0, 0, 0, 70).in_envelope == D(70) and fig(0, 0, 0, 70).overspent == D(0)
    assert fig(0, 0, 0, -5).in_envelope == D(0) and fig(0, 0, 0, -5).overspent == D(5)
    assert fig(0, 0, 0, 0).in_envelope == D(0) and fig(0, 0, 0, 0).overspent == D(0)


# ---------- A orcar ----------


def test_to_budget_is_the_money_minus_what_is_in_envelopes():
    assert to_budget(D("1000"), [fig(0, 300, 0, 300), fig(0, 200, 50, 150)]) == D("550")


def test_an_overspent_envelope_takes_nothing_from_the_envelopes_total():
    # O gasto ja saiu do dinheiro; o envelope negativo conta como zero: o estouro cai sozinho no "A orcar"
    assert to_budget(D("1000"), [fig(0, 100, 130, -30), fig(0, 200, 0, 200)]) == D("800")


def test_spending_from_an_envelope_does_not_change_to_budget():
    before = to_budget(D("1000"), [fig(0, 300, 0, 300)])
    after = to_budget(D("950"), [fig(0, 300, 50, 250)])
    assert before == after == D("700")


def test_to_budget_goes_negative_when_more_was_allocated_than_exists():
    assert to_budget(D("100"), [fig(0, 300, 0, 300)]) == D("-200")


def test_to_budget_without_envelopes_is_all_the_money():
    assert to_budget(D("42.50"), []) == D("42.50")
