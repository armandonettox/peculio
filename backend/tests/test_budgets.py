import uuid
from datetime import date

import pytest

from app.core import clock
from app.models.budget import BudgetPeriod
from app.models.transaction import TransactionSplit
from app.services.budgets import period_bounds
from tests.conftest import auth_headers, make_user, register

URL = "/api/v1/budgets"
TX_URL = "/api/v1/transactions"
ACCOUNTS_URL = "/api/v1/accounts"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_budget(client, headers, **overrides):
    body = {"name": "Mercado", "currency_code": "BRL", "amount": "800.00", "period": "monthly", **overrides}
    return client.post(URL, json=body, headers=headers)


def make_account(client, headers, **overrides):
    body = {"name": "Nubank", "type": "asset", "currency_code": "BRL", "opening_balance": "5000.00", **overrides}
    return client.post(ACCOUNTS_URL, json=body, headers=headers).json()["id"]


def spend(client, headers, account_id, budget_id, amount="100.00", on="2026-03-10", **overrides):
    split = {
        "type": "withdrawal",
        "date": on,
        "description": "Compra",
        "amount": amount,
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Supermercado",
        "budget_id": budget_id,
        **overrides,
    }
    return client.post(TX_URL, json={"splits": [split]}, headers=headers)


def progress(client, headers, **params):
    return client.get(f"{URL}/progress", params=params, headers=headers)


# ---------- Periodos (funcao pura) ----------


@pytest.mark.parametrize(
    ("period", "reference", "start", "end"),
    [
        # Semana de segunda a domingo
        ("weekly", date(2026, 3, 11), date(2026, 3, 9), date(2026, 3, 15)),
        ("weekly", date(2026, 3, 9), date(2026, 3, 9), date(2026, 3, 15)),
        ("weekly", date(2026, 3, 15), date(2026, 3, 9), date(2026, 3, 15)),
        # Semana que atravessa o mes e o ano
        ("weekly", date(2026, 1, 1), date(2025, 12, 29), date(2026, 1, 4)),
        ("monthly", date(2026, 3, 11), date(2026, 3, 1), date(2026, 3, 31)),
        ("monthly", date(2026, 2, 28), date(2026, 2, 1), date(2026, 2, 28)),
        ("monthly", date(2028, 2, 10), date(2028, 2, 1), date(2028, 2, 29)),
        ("monthly", date(2026, 12, 31), date(2026, 12, 1), date(2026, 12, 31)),
        ("yearly", date(2026, 7, 4), date(2026, 1, 1), date(2026, 12, 31)),
    ],
)
def test_period_bounds(period, reference, start, end):
    assert period_bounds(BudgetPeriod(period), reference) == (start, end)


# ---------- CRUD ----------


def test_requires_login(client):
    assert client.get(URL).status_code == 401
    assert client.post(URL, json={}).status_code == 401
    assert client.get(f"{URL}/progress").status_code == 401


def test_create_returns_the_budget(client, headers):
    resp = make_budget(client, headers, name="  Mercado ")
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Mercado"
    assert body["amount"] == "800.00"
    assert body["period"] == "monthly"
    assert body["currency_code"] == "BRL"
    assert body["active"] is True


@pytest.mark.parametrize(
    "overrides",
    [
        {"amount": "0"},
        {"amount": "-5"},
        {"amount": "abc"},
        {"amount": "10.555"},
        {"name": ""},
        {"name": "   "},
        {"period": "daily"},
        {"currency_code": "BR"},
        {"unknown_field": 1},
    ],
)
def test_create_validation_returns_422(client, headers, overrides):
    assert make_budget(client, headers, **overrides).status_code == 422


def test_unknown_currency_is_refused(client, headers):
    resp = make_budget(client, headers, currency_code="XXX")
    assert resp.status_code == 400
    assert resp.json()["code"] == "currency_not_found"


def test_currency_decimal_places_are_enforced(client, headers):
    resp = make_budget(client, headers, currency_code="JPY", amount="1000.50")
    assert resp.status_code == 400
    assert resp.json()["code"] == "invalid_amount"
    ok = make_budget(client, headers, name="Iene", currency_code="JPY", amount="1000")
    assert ok.status_code == 201
    assert ok.json()["amount"] == "1000"


def test_name_is_unique_per_user_ignoring_case(client, headers):
    make_budget(client, headers, name="Mercado")
    resp = make_budget(client, headers, name="mercado")
    assert resp.status_code == 409
    assert resp.json()["code"] == "budget_name_taken"


def test_the_same_name_can_exist_for_another_user(client, headers, db_session):
    make_budget(client, headers, name="Mercado")
    make_user(db_session, email="outra@example.com")
    assert make_budget(client, auth_headers(client, email="outra@example.com"), name="Mercado").status_code == 201


def test_list_is_alphabetical_and_filters_by_name_and_active(client, headers):
    make_budget(client, headers, name="Viagem")
    mercado = make_budget(client, headers, name="mercado").json()
    make_budget(client, headers, name="Lazer")
    client.patch(f"{URL}/{mercado['id']}", json={"active": False}, headers=headers)

    names = [b["name"] for b in client.get(URL, headers=headers).json()["items"]]
    assert names == ["Lazer", "mercado", "Viagem"]
    assert [b["name"] for b in client.get(URL, params={"q": "ERC"}, headers=headers).json()["items"]] == ["mercado"]
    assert [b["name"] for b in client.get(URL, params={"active": "true"}, headers=headers).json()["items"]] == [
        "Lazer",
        "Viagem",
    ]
    assert [b["name"] for b in client.get(URL, params={"active": "false"}, headers=headers).json()["items"]] == [
        "mercado"
    ]


def test_search_treats_percent_as_text(client, headers):
    make_budget(client, headers, name="Mercado")
    assert client.get(URL, params={"q": "%"}, headers=headers).json()["total"] == 0


def test_get_and_other_users_budget_is_404(client, headers, db_session):
    budget_id = make_budget(client, headers).json()["id"]
    assert client.get(f"{URL}/{budget_id}", headers=headers).json()["name"] == "Mercado"

    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    for call in (
        client.get(f"{URL}/{budget_id}", headers=other),
        client.patch(f"{URL}/{budget_id}", json={"name": "X"}, headers=other),
        client.delete(f"{URL}/{budget_id}", headers=other),
    ):
        assert call.status_code == 404
        assert call.json()["code"] == "budget_not_found"
    assert client.get(URL, headers=other).json()["total"] == 0
    assert client.get(f"{URL}/{uuid.uuid4()}", headers=headers).status_code == 404


def test_patch_changes_only_what_was_sent(client, headers):
    budget_id = make_budget(client, headers).json()["id"]
    body = client.patch(f"{URL}/{budget_id}", json={"amount": "900.00", "period": "weekly"}, headers=headers).json()
    assert body["amount"] == "900.00"
    assert body["period"] == "weekly"
    assert body["name"] == "Mercado"
    assert body["active"] is True


def test_patch_null_does_not_erase_anything(client, headers):
    budget_id = make_budget(client, headers).json()["id"]
    body = client.patch(f"{URL}/{budget_id}", json={"name": None, "amount": None}, headers=headers).json()
    assert body["name"] == "Mercado" and body["amount"] == "800.00"


def test_patch_cannot_change_the_currency(client, headers):
    budget_id = make_budget(client, headers).json()["id"]
    assert client.patch(f"{URL}/{budget_id}", json={"currency_code": "USD"}, headers=headers).status_code == 422


def test_patch_rejects_zero_amount_and_name_clash(client, headers):
    first = make_budget(client, headers, name="A").json()["id"]
    make_budget(client, headers, name="B")
    assert client.patch(f"{URL}/{first}", json={"amount": "0"}, headers=headers).status_code == 422
    clash = client.patch(f"{URL}/{first}", json={"name": "b"}, headers=headers)
    assert clash.status_code == 409 and clash.json()["code"] == "budget_name_taken"


def test_patch_respects_the_currency_decimal_places(client, headers):
    budget_id = make_budget(client, headers, currency_code="JPY", amount="1000").json()["id"]
    resp = client.patch(f"{URL}/{budget_id}", json={"amount": "10.5"}, headers=headers)
    assert resp.status_code == 400 and resp.json()["code"] == "invalid_amount"


def test_delete_keeps_the_transactions_without_a_budget(client, headers, db_session):
    account_id = make_account(client, headers)
    budget_id = make_budget(client, headers).json()["id"]
    tx = spend(client, headers, account_id, budget_id).json()

    assert client.delete(f"{URL}/{budget_id}", headers=headers).status_code == 204
    assert client.get(f"{URL}/{budget_id}", headers=headers).status_code == 404

    fetched = client.get(f"{TX_URL}/{tx['id']}", headers=headers).json()
    assert fetched["splits"][0]["budget_id"] is None
    assert db_session.query(TransactionSplit).count() >= 1


# ---------- Ligar lancamentos ao orcamento ----------


def test_a_withdrawal_can_be_linked_and_comes_back_with_the_budget(client, headers):
    account_id = make_account(client, headers)
    budget_id = make_budget(client, headers).json()["id"]
    resp = spend(client, headers, account_id, budget_id)
    assert resp.status_code == 201
    assert resp.json()["splits"][0]["budget_id"] == budget_id


def test_a_transaction_without_budget_has_none(client, headers):
    account_id = make_account(client, headers)
    resp = spend(client, headers, account_id, None)
    assert resp.json()["splits"][0]["budget_id"] is None


def test_budget_of_another_user_is_refused(client, headers, db_session):
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    foreign = make_budget(client, other).json()["id"]
    account_id = make_account(client, headers)

    resp = spend(client, headers, account_id, foreign)
    assert resp.status_code == 404
    assert resp.json()["code"] == "budget_not_found"


def test_unknown_budget_is_refused(client, headers):
    account_id = make_account(client, headers)
    assert spend(client, headers, account_id, str(uuid.uuid4())).status_code == 404


def test_deposit_and_transfer_cannot_have_a_budget(client, headers):
    account_id = make_account(client, headers)
    other_id = make_account(client, headers, name="Poupanca")
    budget_id = make_budget(client, headers).json()["id"]

    deposit = spend(client, headers, account_id, budget_id, type="deposit", counterparty_name="Empregador")
    assert deposit.status_code == 400 and deposit.json()["code"] == "budget_not_allowed"

    transfer = spend(
        client, headers, account_id, budget_id, type="transfer", counterparty_name=None, counterparty_account_id=other_id
    )
    assert transfer.status_code == 400 and transfer.json()["code"] == "budget_not_allowed"


def test_paying_a_debt_is_not_spending(client, headers):
    account_id = make_account(client, headers)
    debt_id = make_account(client, headers, name="Financiamento", type="liability", role="mortgage", opening_balance="0")
    budget_id = make_budget(client, headers).json()["id"]

    resp = spend(client, headers, account_id, budget_id, counterparty_name=None, counterparty_account_id=debt_id)
    assert resp.status_code == 400 and resp.json()["code"] == "budget_not_allowed"


def test_a_budget_only_takes_withdrawals_in_its_own_currency(client, headers):
    usd_account = make_account(client, headers, name="Wise", currency_code="USD")
    brl_budget = make_budget(client, headers).json()["id"]

    resp = spend(client, headers, usd_account, brl_budget, currency_code="USD")
    assert resp.status_code == 400 and resp.json()["code"] == "currency_mismatch"

    usd_budget = make_budget(client, headers, name="Dolar", currency_code="USD").json()["id"]
    assert spend(client, headers, usd_account, usd_budget, currency_code="USD").status_code == 201


def test_editing_a_transaction_can_change_or_remove_the_budget(client, headers):
    account_id = make_account(client, headers)
    first = make_budget(client, headers, name="A").json()["id"]
    second = make_budget(client, headers, name="B").json()["id"]
    tx = spend(client, headers, account_id, first).json()

    split = {
        "type": "withdrawal",
        "date": "2026-03-10",
        "description": "Compra",
        "amount": "100.00",
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Supermercado",
    }
    moved = client.put(f"{TX_URL}/{tx['id']}", json={"splits": [{**split, "budget_id": second}]}, headers=headers)
    assert moved.json()["splits"][0]["budget_id"] == second

    removed = client.put(f"{TX_URL}/{tx['id']}", json={"splits": [split]}, headers=headers)
    assert removed.json()["splits"][0]["budget_id"] is None


def test_a_failed_link_keeps_the_old_transaction(client, headers):
    account_id = make_account(client, headers)
    budget_id = make_budget(client, headers).json()["id"]
    tx = spend(client, headers, account_id, budget_id).json()
    bad = {**tx["splits"][0], "account_id": account_id, "counterparty_name": "Supermercado", "budget_id": str(uuid.uuid4())}
    for key in ("id", "source_account_id", "destination_account_id", "source_account_name", "source_account_type",
                "destination_account_name", "destination_account_type", "foreign_amount", "foreign_currency_code", "tag_ids", "cleared", "locked"):
        bad.pop(key, None)

    assert client.put(f"{TX_URL}/{tx['id']}", json={"splits": [bad]}, headers=headers).status_code == 404
    assert client.get(f"{TX_URL}/{tx['id']}", headers=headers).json()["splits"][0]["budget_id"] == budget_id


def test_list_transactions_filters_by_budget(client, headers):
    account_id = make_account(client, headers)
    first = make_budget(client, headers, name="A").json()["id"]
    second = make_budget(client, headers, name="B").json()["id"]
    spend(client, headers, account_id, first, description="da A")
    spend(client, headers, account_id, second, description="da B")
    spend(client, headers, account_id, None, description="sem orcamento")

    items = client.get(TX_URL, params={"budget_id": first}, headers=headers).json()["items"]
    assert [i["splits"][0]["description"] for i in items] == ["da A"]


# ---------- Progresso ----------


def test_progress_sums_only_the_period_of_the_given_date(client, headers):
    account_id = make_account(client, headers)
    budget_id = make_budget(client, headers, amount="800.00").json()["id"]
    spend(client, headers, account_id, budget_id, amount="100.00", on="2026-03-01")
    spend(client, headers, account_id, budget_id, amount="250.50", on="2026-03-31")
    spend(client, headers, account_id, budget_id, amount="999.00", on="2026-02-28")
    spend(client, headers, account_id, budget_id, amount="999.00", on="2026-04-01")

    [item] = progress(client, headers, on="2026-03-15").json()
    assert item["period_start"] == "2026-03-01" and item["period_end"] == "2026-03-31"
    assert item["spent"] == "350.50"
    assert item["remaining"] == "449.50"
    assert item["amount"] == "800.00"
    assert item["percent"] == 43


def test_progress_for_other_periods_shows_their_own_spending(client, headers):
    account_id = make_account(client, headers)
    budget_id = make_budget(client, headers).json()["id"]
    spend(client, headers, account_id, budget_id, amount="999.00", on="2026-02-28")

    assert progress(client, headers, on="2026-02-10").json()[0]["spent"] == "999.00"
    assert progress(client, headers, on="2026-03-10").json()[0]["spent"] == "0.00"


def test_progress_over_the_limit_has_negative_remaining(client, headers):
    account_id = make_account(client, headers)
    budget_id = make_budget(client, headers, amount="100.00").json()["id"]
    spend(client, headers, account_id, budget_id, amount="130.00")

    [item] = progress(client, headers, on="2026-03-10").json()
    assert item["remaining"] == "-30.00"
    assert item["percent"] == 130


def test_percent_never_rounds_up_to_the_limit(client, headers):
    account_id = make_account(client, headers)
    budget_id = make_budget(client, headers, amount="1000.00").json()["id"]
    spend(client, headers, account_id, budget_id, amount="999.99")
    assert progress(client, headers, on="2026-03-10").json()[0]["percent"] == 99

    spend(client, headers, account_id, budget_id, amount="0.01")
    assert progress(client, headers, on="2026-03-10").json()[0]["percent"] == 100


def test_weekly_and_yearly_budgets_use_their_own_periods(client, headers):
    account_id = make_account(client, headers)
    weekly = make_budget(client, headers, name="Semana", period="weekly").json()["id"]
    yearly = make_budget(client, headers, name="Ano", period="yearly", amount="12000.00").json()["id"]
    spend(client, headers, account_id, weekly, amount="10.00", on="2026-03-09")
    spend(client, headers, account_id, weekly, amount="20.00", on="2026-03-16")
    spend(client, headers, account_id, yearly, amount="500.00", on="2026-01-02")
    spend(client, headers, account_id, yearly, amount="700.00", on="2026-12-30")

    by_name = {i["name"]: i for i in progress(client, headers, on="2026-03-11").json()}
    assert by_name["Semana"]["spent"] == "10.00"
    assert (by_name["Semana"]["period_start"], by_name["Semana"]["period_end"]) == ("2026-03-09", "2026-03-15")
    assert by_name["Ano"]["spent"] == "1200.00"


def test_progress_counts_only_withdrawals_of_each_budget(client, headers):
    account_id = make_account(client, headers)
    a = make_budget(client, headers, name="A").json()["id"]
    b = make_budget(client, headers, name="B").json()["id"]
    spend(client, headers, account_id, a, amount="10.00")
    spend(client, headers, account_id, b, amount="20.00")
    spend(client, headers, account_id, None, amount="500.00")

    by_name = {i["name"]: i["spent"] for i in progress(client, headers, on="2026-03-10").json()}
    assert by_name == {"A": "10.00", "B": "20.00"}


def test_a_split_group_counts_each_linked_line(client, headers):
    account_id = make_account(client, headers)
    budget_id = make_budget(client, headers).json()["id"]
    line = {
        "type": "withdrawal",
        "date": "2026-03-10",
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Mercado",
    }
    client.post(
        TX_URL,
        json={
            "title": "Compras",
            "splits": [
                {**line, "description": "Frutas", "amount": "60.00", "budget_id": budget_id},
                {**line, "description": "Limpeza", "amount": "40.00"},
            ],
        },
        headers=headers,
    )
    assert progress(client, headers, on="2026-03-10").json()[0]["spent"] == "60.00"


def test_progress_hides_archived_unless_asked(client, headers):
    make_budget(client, headers, name="Ativo")
    old = make_budget(client, headers, name="Velho").json()["id"]
    client.patch(f"{URL}/{old}", json={"active": False}, headers=headers)

    assert [i["name"] for i in progress(client, headers).json()] == ["Ativo"]
    assert [i["name"] for i in progress(client, headers, include_archived="true").json()] == ["Ativo", "Velho"]


def test_progress_defaults_to_today(client, headers):
    account_id = make_account(client, headers)
    budget_id = make_budget(client, headers).json()["id"]
    spend(client, headers, account_id, budget_id, amount="10.00", on=clock.today().isoformat())
    [item] = progress(client, headers).json()
    assert item["spent"] == "10.00"
    assert item["period_start"] <= clock.today().isoformat() <= item["period_end"]


def test_progress_is_empty_without_budgets(client, headers):
    assert progress(client, headers).json() == []


def test_progress_does_not_mix_users(client, headers, db_session):
    account_id = make_account(client, headers)
    budget_id = make_budget(client, headers).json()["id"]
    spend(client, headers, account_id, budget_id, amount="10.00")

    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    make_budget(client, other, name="Dela")
    assert [i["name"] for i in progress(client, other, on="2026-03-10").json()] == ["Dela"]
    assert progress(client, other, on="2026-03-10").json()[0]["spent"] == "0.00"


def test_progress_formats_money_with_the_currency_places(client, headers):
    account_id = make_account(client, headers, name="Toquio", currency_code="JPY", opening_balance="100000")
    budget_id = make_budget(client, headers, name="Iene", currency_code="JPY", amount="10000").json()["id"]
    spend(client, headers, account_id, budget_id, amount="2500", currency_code="JPY")

    [item] = progress(client, headers, on="2026-03-10").json()
    assert (item["amount"], item["spent"], item["remaining"]) == ("10000", "2500", "7500")


def test_progress_uses_few_queries_regardless_of_the_number_of_budgets(client, headers, db_session):
    from sqlalchemy import event

    from app.core.database import engine

    account_id = make_account(client, headers)
    for index in range(8):
        budget_id = make_budget(client, headers, name=f"Orc {index}", period=["weekly", "monthly", "yearly"][index % 3]).json()["id"]
        spend(client, headers, account_id, budget_id, amount="1.00")

    statements: list[str] = []

    def count(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        assert len(progress(client, headers, on="2026-03-10").json()) == 8
    finally:
        event.remove(engine, "before_cursor_execute", count)

    # Autenticacao (1), orcamentos (1), moedas (1) e no maximo 3 somas (semana, mes, ano)
    assert len(statements) <= 8, statements
