from datetime import date, timedelta

import pytest

from app.services.invoices import due_date_for, period_for


@pytest.mark.parametrize(
    ("on", "closing_day", "expected_start", "expected_end"),
    [
        # No proprio dia do fechamento, a compra ainda entra no periodo que fecha nele
        (date(2026, 1, 28), 28, date(2025, 12, 29), date(2026, 1, 28)),
        # No dia seguinte, ja cai no periodo seguinte (fecha no mes que vem)
        (date(2026, 1, 29), 28, date(2026, 1, 29), date(2026, 2, 28)),
        (date(2026, 2, 1), 28, date(2026, 1, 29), date(2026, 2, 28)),
        # Fechamento dia 31: fevereiro nao tem, entao fecha no ultimo dia (28, ou 29 em bissexto)
        (date(2026, 2, 15), 31, date(2026, 2, 1), date(2026, 2, 28)),
        (date(2028, 2, 15), 31, date(2028, 2, 1), date(2028, 2, 29)),
        # Virada de ano, nos dois sentidos
        (date(2026, 1, 5), 28, date(2025, 12, 29), date(2026, 1, 28)),
        (date(2026, 12, 29), 28, date(2026, 12, 29), date(2027, 1, 28)),
    ],
)
def test_period_for(on, closing_day, expected_start, expected_end):
    assert period_for(on, closing_day) == (expected_start, expected_end)


def test_period_for_is_contiguous_across_the_year():
    # O fim de um periodo e sempre a vespera do inicio do seguinte, sem buraco nem sobreposicao
    closing_day = 10
    previous_end = None
    for month_offset in range(0, 24):
        year = 2026 + month_offset // 12
        month = month_offset % 12 + 1
        on = date(year, month, 15)
        start, end = period_for(on, closing_day)
        if previous_end is not None:
            # Sem buraco nem sobreposicao: comeca no dia seguinte ao fim do periodo anterior
            assert start == previous_end + timedelta(days=1)
        previous_end = end


@pytest.mark.parametrize(
    ("period_end", "due_day", "expected"),
    [
        # Caso comum: fecha dia 28, vence dia 5 do mes seguinte
        (date(2026, 1, 28), 5, date(2026, 2, 5)),
        # Vencimento depois do fechamento mas no mesmo mes
        (date(2026, 1, 10), 20, date(2026, 1, 20)),
        # Fechamento em dezembro: vencimento vira o ano
        (date(2026, 12, 28), 5, date(2027, 1, 5)),
    ],
)
def test_due_date_for(period_end, due_day, expected):
    assert due_date_for(period_end, due_day) == expected
