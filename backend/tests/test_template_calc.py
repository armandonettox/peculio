from datetime import date
from decimal import Decimal

import pytest

from app.models.bill import BillFrequency
from app.services.template_calc import (
    bill_amount,
    by_date_amount,
    due_dates_in_month,
    goal_state,
    months_left,
    split_remainder,
    step,
    total,
)

D = Decimal
MAR, APR, JUN = date(2026, 3, 1), date(2026, 4, 1), date(2026, 6, 1)


def test_step_follows_the_decimal_places():
    assert step(2) == D("0.01") and step(0) == D("1") and step(3) == D("0.001")


@pytest.mark.parametrize(
    "month, target, expected",
    [
        (MAR, MAR, 1),
        (MAR, APR, 2),
        (MAR, JUN, 4),
        (date(2025, 11, 1), date(2026, 2, 1), 4),
        (APR, MAR, 0),
        (date(2026, 12, 1), date(2027, 1, 1), 2),
    ],
)
def test_months_left_counts_both_ends_and_is_zero_after_the_date(month, target, expected):
    assert months_left(month, target) == expected


def test_by_date_divides_what_is_missing_by_the_months_left():
    assert by_date_amount(D("6000"), JUN, MAR, D("0"), 2) == D("1500.00")
    assert by_date_amount(D("6000"), JUN, MAR, D("1000"), 2) == D("1250.00")


def test_by_date_rounds_up_so_the_goal_is_never_short():
    assert by_date_amount(D("100"), JUN, MAR, D("0"), 2) == D("25.00")
    assert by_date_amount(D("100"), date(2026, 5, 1), MAR, D("0"), 2) == D("33.34")
    assert by_date_amount(D("100"), date(2026, 5, 1), MAR, D("0"), 0) == D("34")


def test_by_date_in_the_target_month_asks_for_everything_missing():
    assert by_date_amount(D("500"), MAR, MAR, D("120"), 2) == D("380.00")


@pytest.mark.parametrize("carried", ["600", "601.50"])
def test_by_date_is_zero_when_the_goal_is_already_met(carried):
    assert by_date_amount(D("600"), JUN, MAR, D(carried), 2) == D("0")


def test_by_date_is_zero_after_the_date_even_if_missing():
    assert by_date_amount(D("600"), MAR, APR, D("0"), 2) == D("0")


# ---------- Conta a pagar ----------


def test_a_monthly_bill_has_one_due_date_in_each_month():
    assert due_dates_in_month(date(2026, 1, 5), BillFrequency.monthly, MAR) == [date(2026, 3, 5)]


def test_a_monthly_bill_does_not_exist_before_its_first_due_date():
    assert due_dates_in_month(date(2026, 5, 5), BillFrequency.monthly, MAR) == []
    assert due_dates_in_month(date(2026, 3, 20), BillFrequency.monthly, MAR) == [date(2026, 3, 20)]
    assert due_dates_in_month(date(2026, 3, 31), BillFrequency.monthly, MAR) == [date(2026, 3, 31)]


def test_a_quarterly_bill_only_has_a_due_date_every_third_month():
    first = date(2026, 1, 10)
    assert due_dates_in_month(first, BillFrequency.quarterly, date(2026, 1, 1)) == [first]
    assert due_dates_in_month(first, BillFrequency.quarterly, date(2026, 2, 1)) == []
    assert due_dates_in_month(first, BillFrequency.quarterly, date(2026, 3, 1)) == []
    assert due_dates_in_month(first, BillFrequency.quarterly, date(2026, 4, 1)) == [date(2026, 4, 10)]


def test_a_yearly_bill_has_one_due_date_a_year():
    first = date(2025, 3, 8)
    assert due_dates_in_month(first, BillFrequency.yearly, MAR) == [date(2026, 3, 8)]
    assert due_dates_in_month(first, BillFrequency.yearly, APR) == []


def test_a_weekly_bill_has_four_or_five_due_dates_a_month():
    first = date(2026, 3, 2)  # segunda-feira
    assert due_dates_in_month(first, BillFrequency.weekly, MAR) == [
        date(2026, 3, 2), date(2026, 3, 9), date(2026, 3, 16), date(2026, 3, 23), date(2026, 3, 30)
    ]
    assert len(due_dates_in_month(first, BillFrequency.weekly, APR)) == 4


def test_a_bill_due_on_the_last_day_of_a_short_month_counts_there():
    assert due_dates_in_month(date(2026, 1, 31), BillFrequency.monthly, date(2026, 2, 1)) == [date(2026, 2, 28)]


def test_bill_amount_is_the_top_of_the_range_times_the_due_dates():
    assert bill_amount(D("1900.00"), date(2026, 1, 8), BillFrequency.monthly, MAR) == D("1900.00")
    assert bill_amount(D("50"), date(2026, 3, 2), BillFrequency.weekly, MAR) == D("250")
    assert bill_amount(D("300"), date(2026, 1, 10), BillFrequency.quarterly, date(2026, 2, 1)) == D("0")


# ---------- O que sobrar ----------


def test_remainder_splits_evenly_and_rounds_down():
    assert split_remainder(D("100"), 3, 2) == D("33.33")
    assert split_remainder(D("100"), 4, 2) == D("25.00")
    assert split_remainder(D("100"), 3, 0) == D("33")


@pytest.mark.parametrize("left, count", [("0", 2), ("-50", 2), ("100", 0), ("100", -1)])
def test_remainder_is_zero_without_money_or_envelopes(left, count):
    assert split_remainder(D(left), count, 2) == D("0")


def test_the_parts_never_add_up_to_more_than_what_was_left():
    part = split_remainder(D("100"), 3, 2)
    assert part * 3 <= D("100")


# ---------- Selo de meta ----------


@pytest.mark.parametrize(
    "allocated, wanted, expected",
    [
        ("300", "300", "met"),
        ("350", "300", "met"),
        ("150", "300", "partial"),
        ("149.99", "300", "short"),
        ("0", "300", "short"),
        ("0", "0", None),
        ("100", "0", None),
        ("-5", "0", None),
    ],
)
def test_goal_state(allocated, wanted, expected):
    assert goal_state(D(allocated), D(wanted)) == expected


def test_total_sums_exactly():
    assert total([D("0.10"), D("0.20")]) == D("0.30")
    assert total([]) == D("0")
