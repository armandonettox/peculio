from decimal import Decimal

import pytest

from app.services.recon_calc import adjustment, difference, is_reconciled, signed_effect

D = Decimal


@pytest.mark.parametrize(
    "statement, cleared, expected",
    [("1000", "1000", "0"), ("1000", "900", "100"), ("900", "1000", "-100"), ("0.30", "0.10", "0.20"), ("-50", "-80", "30")],
)
def test_difference_is_the_statement_minus_the_cleared(statement, cleared, expected):
    assert difference(D(statement), D(cleared)) == D(expected)


def test_only_a_zero_difference_is_reconciled():
    assert is_reconciled(D("0")) and is_reconciled(D("0.00"))
    assert not is_reconciled(D("0.01")) and not is_reconciled(D("-0.01"))


def test_the_adjustment_follows_the_sign_of_the_difference():
    assert adjustment(D("100.50")) == ("deposit", D("100.50"))
    assert adjustment(D("-30")) == ("withdrawal", D("30"))
    assert adjustment(D("0")) is None
    assert adjustment(D("0.00")) is None


def test_the_adjustment_always_brings_the_difference_to_zero():
    for diff in (D("12.34"), D("-12.34"), D("0.01")):
        kind, amount = adjustment(diff)
        effect = signed_effect(kind == "deposit", amount)
        assert effect == diff


def test_signed_effect_adds_when_destination_and_subtracts_when_source():
    assert signed_effect(True, D("50")) == D("50")
    assert signed_effect(False, D("50")) == D("-50")
