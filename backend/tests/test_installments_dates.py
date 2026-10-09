from decimal import Decimal

import pytest

from app.services.installments import split_amount


@pytest.mark.parametrize(
    ("total", "count", "expected"),
    [
        # Divide exato: todas as partes iguais
        (Decimal("300.00"), 3, [Decimal("100.00"), Decimal("100.00"), Decimal("100.00")]),
        # Nao divide exato: a ultima parte absorve o resto, sem perder nem sobrar centavo
        (Decimal("100.00"), 3, [Decimal("33.33"), Decimal("33.33"), Decimal("33.34")]),
        (Decimal("10.00"), 3, [Decimal("3.33"), Decimal("3.33"), Decimal("3.34")]),
        (Decimal("0.01"), 1, [Decimal("0.01")]),
    ],
)
def test_split_amount(total, count, expected):
    parts = split_amount(total, count)
    assert parts == expected
    assert sum(parts) == total
