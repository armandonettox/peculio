from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import event

from app.core import clock
from app.core.database import engine
from tests.conftest import auth_headers, make_user, register

URL = "/api/v1/dashboard/net-worth"
ACCOUNTS_URL = "/api/v1/accounts"
TX_URL = "/api/v1/transactions"

# Dia fixo do relogio do app em quase todos os testes
TODAY = date(2026, 6, 15)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "today", lambda now=None: TODAY)


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_account(client, headers, name="Nubank", kind="asset", currency="BRL", opening="0", on="2025-01-01"):
    body = {
        "name": name,
        "type": kind,
        "currency_code": currency,
        "opening_balance": opening,
        "opening_balance_date": on,
    }
    resp = client.post(ACCOUNTS_URL, json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def split(kind, on, amount, account_id, currency="BRL", **extra):
    return {
        "type": kind,
        "date": on,
        "description": "Movimento ficticio",
        "amount": amount,
        "currency_code": currency,
        "account_id": account_id,
        **extra,
    }


def post_tx(client, headers, *splits):
    resp = client.post(TX_URL, json={"splits": list(splits)}, headers=headers)
    assert resp.status_code == 201, resp.text


def income(client, headers, account_id, on, amount, currency="BRL"):
    post_tx(client, headers, split("deposit", on, amount, account_id, currency, counterparty_name="Empresa Exemplo"))


def expense(client, headers, account_id, on, amount, currency="BRL", **extra):
    post_tx(
        client, headers, split("withdrawal", on, amount, account_id, currency, counterparty_name="Loja Exemplo", **extra)
    )


def transfer(client, headers, source_id, target_id, on, amount, currency="BRL", **extra):
    post_tx(client, headers, split("transfer", on, amount, source_id, currency, counterparty_account_id=target_id, **extra))


def get(client, headers, **params):
    return client.get(URL, params=params, headers=headers)


def currency_of(body, code):
    return next(c for c in body["currencies"] if c["currency_code"] == code)


def nets(currency):
    return [point["net"] for point in currency["series"]]


# ---------- Forma da resposta ----------


def test_user_without_accounts_gets_an_empty_list(client, headers):
    resp = get(client, headers)
    assert resp.status_code == 200
    assert resp.json() == {"as_of": "2026-06-15", "months": 12, "currencies": []}


def test_default_is_twelve_months_ending_in_the_current_month(client, headers):
    make_account(client, headers)
    body = get(client, headers).json()
    labels = [point["month"] for point in body["currencies"][0]["series"]]
    assert body["months"] == 12
    assert labels[0] == "2025-07"
    assert labels[-1] == "2026-06"
    assert len(labels) == 12
    assert labels == sorted(labels)


def test_account_without_movement_makes_its_currency_appear_with_zeros(client, headers):
    make_account(client, headers, currency="USD")
    body = get(client, headers, months=3).json()
    assert [c["currency_code"] for c in body["currencies"]] == ["USD"]
    usd = body["currencies"][0]
    assert (usd["assets"], usd["liabilities"], usd["net"]) == ("0.00", "0.00", "0.00")
    assert nets(usd) == ["0.00", "0.00", "0.00"]


def test_system_accounts_do_not_add_currencies(client, headers):
    make_account(client, headers, opening="100.00")
    body = get(client, headers).json()
    assert [c["currency_code"] for c in body["currencies"]] == ["BRL"]


# ---------- Serie e acumulo ----------


def test_series_is_the_balance_at_the_end_of_each_month_and_empty_months_repeat(client, headers):
    account = make_account(client, headers, opening="1000.00", on="2026-03-10")
    expense(client, headers, account, "2026-04-05", "200.00")
    income(client, headers, account, "2026-06-01", "50.00")
    brl = currency_of(get(client, headers, months=6).json(), "BRL")
    assert [point["month"] for point in brl["series"]] == [
        "2026-01",
        "2026-02",
        "2026-03",
        "2026-04",
        "2026-05",
        "2026-06",
    ]
    assert nets(brl) == ["0.00", "0.00", "1000.00", "800.00", "800.00", "850.00"]
    assert [p["assets"] for p in brl["series"]] == nets(brl)
    assert all(p["liabilities"] == "0.00" for p in brl["series"])


def test_history_before_the_window_enters_the_starting_balance(client, headers):
    account = make_account(client, headers, opening="1000.00", on="2020-01-01")
    expense(client, headers, account, "2024-05-05", "100.00")
    expense(client, headers, account, "2026-06-02", "10.00")
    brl = currency_of(get(client, headers, months=2).json(), "BRL")
    assert nets(brl) == ["900.00", "890.00"]


def test_months_one_is_only_the_current_month_with_the_whole_history(client, headers):
    account = make_account(client, headers, opening="300.00", on="2025-02-01")
    expense(client, headers, account, "2026-06-10", "25.50")
    brl = currency_of(get(client, headers, months=1).json(), "BRL")
    assert [p["month"] for p in brl["series"]] == ["2026-06"]
    assert brl["net"] == "274.50"


def test_months_thirty_six_crosses_years_and_carries_the_old_balance(client, headers):
    account = make_account(client, headers, opening="500.00", on="2023-06-30")
    income(client, headers, account, "2023-07-01", "100.00")
    brl = currency_of(get(client, headers, months=36).json(), "BRL")
    series = brl["series"]
    assert len(series) == 36
    assert series[0]["month"] == "2023-07"
    assert series[-1]["month"] == "2026-06"
    # O saldo de abertura e de antes da janela; a receita de 01/07/2023 e do primeiro mes
    assert series[0]["net"] == "600.00"
    assert series[-1]["net"] == "600.00"


def test_movement_older_than_the_window_is_not_lost(client, headers):
    account = make_account(client, headers, opening="0", on="2020-01-01")
    income(client, headers, account, "2020-01-02", "70.00")
    brl = currency_of(get(client, headers, months=12).json(), "BRL")
    assert set(nets(brl)) == {"70.00"}


def test_the_same_month_of_another_year_is_not_mixed(client, headers):
    account = make_account(client, headers, opening="0", on="2025-06-01")
    income(client, headers, account, "2025-06-20", "40.00")
    income(client, headers, account, "2026-06-02", "5.00")
    brl = currency_of(get(client, headers, months=2).json(), "BRL")
    # Maio de 2026 so enxerga a receita de junho de 2025
    assert nets(brl) == ["40.00", "45.00"]


# ---------- Viradas de mes, de ano e bissexto ----------


def test_last_day_of_the_month_counts_for_it_and_the_first_day_for_the_next(client, headers):
    account = make_account(client, headers, opening="0", on="2026-01-01")
    income(client, headers, account, "2026-05-31", "10.00")
    income(client, headers, account, "2026-06-01", "1.00")
    brl = currency_of(get(client, headers, months=2).json(), "BRL")
    assert nets(brl) == ["10.00", "11.00"]


def test_year_boundary_labels_and_balances(client, headers, monkeypatch):
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 1, 10))
    account = make_account(client, headers, opening="0", on="2025-01-01")
    income(client, headers, account, "2025-12-31", "20.00")
    income(client, headers, account, "2026-01-01", "3.00")
    brl = currency_of(get(client, headers, months=3).json(), "BRL")
    assert [p["month"] for p in brl["series"]] == ["2025-11", "2025-12", "2026-01"]
    assert nets(brl) == ["0.00", "20.00", "23.00"]


def test_leap_year_february(client, headers, monkeypatch):
    monkeypatch.setattr(clock, "today", lambda now=None: date(2028, 3, 1))
    account = make_account(client, headers, opening="0", on="2028-01-01")
    income(client, headers, account, "2028-02-29", "8.00")
    income(client, headers, account, "2028-03-01", "2.00")
    brl = currency_of(get(client, headers, months=3).json(), "BRL")
    assert [p["month"] for p in brl["series"]] == ["2028-01", "2028-02", "2028-03"]
    assert nets(brl) == ["0.00", "8.00", "10.00"]


def test_non_leap_year_has_no_february_29_issue(client, headers, monkeypatch):
    monkeypatch.setattr(clock, "today", lambda now=None: date(2027, 3, 1))
    account = make_account(client, headers, opening="0", on="2027-01-01")
    income(client, headers, account, "2027-02-28", "8.00")
    brl = currency_of(get(client, headers, months=2).json(), "BRL")
    assert nets(brl) == ["8.00", "8.00"]


# ---------- Relogio e lancamentos futuros ----------


def test_as_of_comes_from_the_app_clock(client, headers, monkeypatch):
    make_account(client, headers)
    assert get(client, headers).json()["as_of"] == "2026-06-15"
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 7, 1))
    body = get(client, headers, months=1).json()
    assert body["as_of"] == "2026-07-01"
    assert body["currencies"][0]["series"][0]["month"] == "2026-07"


def test_future_transactions_are_in_no_point_and_in_no_total(client, headers):
    account = make_account(client, headers, opening="100.00", on="2026-01-01")
    expense(client, headers, account, "2026-06-16", "40.00")
    expense(client, headers, account, "2026-08-01", "10.00")
    brl = currency_of(get(client, headers, months=3).json(), "BRL")
    assert nets(brl) == ["100.00", "100.00", "100.00"]
    assert brl["net"] == "100.00"


def test_transaction_on_the_as_of_day_counts(client, headers):
    account = make_account(client, headers, opening="100.00", on="2026-01-01")
    expense(client, headers, account, "2026-06-15", "40.00")
    brl = currency_of(get(client, headers, months=1).json(), "BRL")
    assert brl["net"] == "60.00"


def test_future_opening_balance_is_ignored_too(client, headers):
    make_account(client, headers, opening="900.00", on="2026-07-01")
    brl = currency_of(get(client, headers, months=1).json(), "BRL")
    assert brl["net"] == "0.00"


# ---------- Ativos, passivos e arquivadas ----------


def test_liability_is_negative_and_net_is_assets_plus_liabilities(client, headers):
    make_account(client, headers, name="Conta", opening="1000.00", on="2026-05-02")
    make_account(client, headers, name="Emprestimo", kind="liability", opening="3000.00", on="2026-05-03")
    brl = currency_of(get(client, headers, months=3).json(), "BRL")
    assert [p["assets"] for p in brl["series"]] == ["0.00", "1000.00", "1000.00"]
    assert [p["liabilities"] for p in brl["series"]] == ["0.00", "-3000.00", "-3000.00"]
    assert nets(brl) == ["0.00", "-2000.00", "-2000.00"]
    assert (brl["assets"], brl["liabilities"], brl["net"]) == ("1000.00", "-3000.00", "-2000.00")


def test_only_liability_still_shows_the_currency(client, headers):
    make_account(client, headers, name="Cartao Antigo", kind="liability", currency="USD", opening="50.00")
    usd = currency_of(get(client, headers).json(), "USD")
    assert (usd["assets"], usd["liabilities"], usd["net"]) == ("0.00", "-50.00", "-50.00")


def test_archived_account_still_counts(client, headers):
    account = make_account(client, headers, opening="400.00", on="2026-01-01")
    other = make_account(client, headers, name="Outra", opening="100.00", on="2026-01-01")
    resp = client.patch(f"{ACCOUNTS_URL}/{account}", json={"active": False}, headers=headers)
    assert resp.status_code == 200 and resp.json()["active"] is False
    brl = currency_of(get(client, headers, months=1).json(), "BRL")
    assert brl["net"] == "500.00"
    assert other


def test_archived_liability_still_counts(client, headers):
    debt = make_account(client, headers, name="Divida", kind="liability", opening="80.00", on="2026-01-01")
    client.patch(f"{ACCOUNTS_URL}/{debt}", json={"active": False}, headers=headers)
    brl = currency_of(get(client, headers, months=1).json(), "BRL")
    assert brl["liabilities"] == "-80.00"


# ---------- Transferencias e moedas ----------


def test_transfer_between_own_accounts_of_the_same_currency_keeps_net(client, headers):
    a = make_account(client, headers, name="A", opening="1000.00", on="2026-01-01")
    b = make_account(client, headers, name="B", opening="0", on="2026-01-01")
    before = currency_of(get(client, headers, months=2).json(), "BRL")["net"]
    transfer(client, headers, a, b, "2026-06-10", "400.00")
    brl = currency_of(get(client, headers, months=2).json(), "BRL")
    assert brl["net"] == before == "1000.00"
    assert brl["assets"] == "1000.00"


def test_paying_a_debt_from_an_asset_keeps_net_and_shrinks_the_debt(client, headers):
    cash = make_account(client, headers, name="Conta", opening="1000.00", on="2026-01-01")
    debt = make_account(client, headers, name="Divida", kind="liability", opening="600.00", on="2026-01-01")
    post_tx(client, headers, split("withdrawal", "2026-06-10", "250.00", cash, counterparty_account_id=debt))
    brl = currency_of(get(client, headers, months=2).json(), "BRL")
    assert (brl["assets"], brl["liabilities"], brl["net"]) == ("750.00", "-350.00", "400.00")
    assert brl["series"][0]["net"] == "400.00"


def test_currencies_never_mix_and_are_sorted_by_code(client, headers):
    make_account(client, headers, name="Reais", currency="BRL", opening="10.00", on="2026-01-01")
    make_account(client, headers, name="Dolares", currency="USD", opening="20.00", on="2026-01-01")
    make_account(client, headers, name="Ienes", currency="JPY", opening="3000", on="2026-01-01")
    body = get(client, headers, months=1).json()
    assert [c["currency_code"] for c in body["currencies"]] == ["BRL", "JPY", "USD"]
    assert currency_of(body, "BRL")["net"] == "10.00"
    assert currency_of(body, "USD")["net"] == "20.00"
    # O iene nao tem casas decimais
    assert currency_of(body, "JPY")["net"] == "3000"


def test_foreign_amount_credits_the_destination_in_its_currency(client, headers):
    brl_account = make_account(client, headers, name="Reais", opening="1000.00", on="2026-01-01")
    usd_account = make_account(client, headers, name="Dolares", currency="USD", opening="0", on="2026-01-01")
    transfer(
        client,
        headers,
        brl_account,
        usd_account,
        "2026-06-10",
        "500.00",
        foreign_amount="100.00",
        foreign_currency_code="USD",
    )
    body = get(client, headers, months=1).json()
    assert currency_of(body, "BRL")["net"] == "500.00"
    assert currency_of(body, "USD")["net"] == "100.00"


def test_informative_foreign_amount_on_an_expense_does_not_change_the_balance(client, headers):
    account = make_account(client, headers, opening="1000.00", on="2026-01-01")
    expense(client, headers, account, "2026-06-10", "100.00", foreign_amount="20.00", foreign_currency_code="USD")
    brl = currency_of(get(client, headers, months=1).json(), "BRL")
    assert brl["net"] == "900.00"
    assert [c["currency_code"] for c in get(client, headers).json()["currencies"]] == ["BRL"]


# ---------- Coerencia com o livro-caixa ----------


def test_last_point_equals_the_totals_and_the_sum_of_account_balances(client, headers):
    cash = make_account(client, headers, name="Conta", opening="1000.00", on="2026-01-10")
    saving = make_account(client, headers, name="Poupanca", opening="200.00", on="2026-02-10")
    debt = make_account(client, headers, name="Divida", kind="liability", opening="300.00", on="2026-02-11")
    usd = make_account(client, headers, name="Dolares", currency="USD", opening="50.00", on="2026-03-01")
    expense(client, headers, cash, "2026-03-03", "123.45")
    income(client, headers, saving, "2026-04-04", "10.10")
    transfer(client, headers, cash, saving, "2026-05-05", "77.70")
    post_tx(client, headers, split("withdrawal", "2026-06-02", "100.00", saving, counterparty_account_id=debt))
    expense(client, headers, usd, "2026-06-03", "5.55", "USD")
    body = get(client, headers, months=12).json()
    balances = {}
    for item in client.get(ACCOUNTS_URL, headers=headers).json()["items"]:
        balances[item["currency_code"]] = balances.get(item["currency_code"], Decimal(0)) + Decimal(item["balance"])
    for currency in body["currencies"]:
        last = currency["series"][-1]
        assert (currency["assets"], currency["liabilities"], currency["net"]) == (
            last["assets"],
            last["liabilities"],
            last["net"],
        )
        assert Decimal(currency["net"]) == balances[currency["currency_code"]]
        assert Decimal(last["assets"]) + Decimal(last["liabilities"]) == Decimal(last["net"])


# ---------- Isolamento, parametros e autenticacao ----------


def test_other_users_data_never_shows_up(client, headers, db_session):
    make_account(client, headers, opening="100.00", on="2026-01-01")
    make_user(db_session, email="outro@example.com")
    other = auth_headers(client, email="outro@example.com")
    other_account = make_account(client, other, name="Dele", currency="USD", opening="999.00", on="2026-01-01")
    income(client, other, other_account, "2026-06-01", "1.00", "USD")
    mine = get(client, headers, months=1).json()
    assert [c["currency_code"] for c in mine["currencies"]] == ["BRL"]
    assert mine["currencies"][0]["net"] == "100.00"
    theirs = get(client, other, months=1).json()
    assert [c["currency_code"] for c in theirs["currencies"]] == ["USD"]
    assert theirs["currencies"][0]["net"] == "1000.00"


@pytest.mark.parametrize("months", ["0", "37", "-1", "abc", "1.5", ""])
def test_invalid_months_are_rejected(client, headers, months):
    assert get(client, headers, months=months).status_code == 422


@pytest.mark.parametrize("months", [1, 36])
def test_limits_of_months_are_accepted(client, headers, months):
    resp = get(client, headers, months=months)
    assert resp.status_code == 200
    assert resp.json()["months"] == months


def test_authentication_is_required(client):
    assert client.get(URL).status_code == 401
    assert client.get(URL, headers={"Authorization": "Bearer invalido"}).status_code == 401


# ---------- Desempenho ----------


def count_statements(client, headers, **params):
    statements: list[str] = []

    def record(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        assert get(client, headers, **params).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return len(statements)


def test_number_of_queries_does_not_grow_with_accounts_or_months(client, headers):
    first = make_account(client, headers, name="Primeira", opening="10.00", on="2026-01-01")
    small = count_statements(client, headers, months=1)
    for index in range(8):
        extra = make_account(
            client,
            headers,
            name=f"Conta {index}",
            kind="liability" if index % 2 else "asset",
            currency=["BRL", "USD", "JPY"][index % 3],
            opening="5",
            on="2026-01-01",
        )
        if index % 2 == 0:
            expense(client, headers, extra, f"2026-0{1 + index % 5}-1{index}", "1", ["BRL", "USD", "JPY"][index % 3])
    for index in range(6):
        income(client, headers, first, f"2026-0{1 + index}-05", "3.00")
    assert count_statements(client, headers, months=1) == small
    assert count_statements(client, headers, months=12) == small
    assert count_statements(client, headers, months=36) == small
