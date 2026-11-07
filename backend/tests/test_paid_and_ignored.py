"""Lancamento pago/nao pago e ignorado.

Nao pago: nao mexe no saldo da conta, mas conta nos totais. Ignorado: mexe no saldo, mas sai dos
totais, relatorios e orcamentos. O mesmo comportamento do Mobills.
"""

import pytest

from tests.conftest import auth_headers, make_user, register

URL = "/api/v1/transactions"
ACCOUNTS_URL = "/api/v1/accounts"
REPORT_URL = "/api/v1/reports/summary"
BUDGETS_URL = "/api/v1/budgets"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_account(client, headers):
    body = {"name": "Itau", "type": "asset", "currency_code": "BRL", "opening_balance": "100.00"}
    return client.post(ACCOUNTS_URL, json=body, headers=headers).json()["id"]


def split(account_id, amount="10.00", **overrides):
    return {
        "type": "withdrawal",
        "date": "2026-03-10",
        "description": "Compra",
        "amount": amount,
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Mercado",
        **overrides,
    }


def create(client, headers, account_id, **overrides):
    resp = client.post(URL, json={"splits": [split(account_id, **overrides)]}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def balance(client, headers, account_id):
    return client.get(f"{ACCOUNTS_URL}/{account_id}", headers=headers).json()["balance"]


def expense_total(client, headers):
    params = {"date_from": "2026-03-01", "date_to": "2026-03-31"}
    blocks = client.get(REPORT_URL, params=params, headers=headers).json()["currencies"]
    return blocks[0]["expense"] if blocks else "0.00"


def test_new_transaction_is_paid_and_not_ignored_by_default(client, headers):
    account_id = make_account(client, headers)
    out = create(client, headers, account_id)
    assert out["splits"][0]["is_paid"] is True
    assert out["splits"][0]["ignored"] is False


def test_unpaid_does_not_change_the_balance(client, headers):
    account_id = make_account(client, headers)
    create(client, headers, account_id, amount="10.00", is_paid=False)
    assert balance(client, headers, account_id) == "100.00"


def test_unpaid_still_counts_in_the_expense_total(client, headers):
    account_id = make_account(client, headers)
    create(client, headers, account_id, amount="10.00", is_paid=False)
    create(client, headers, account_id, amount="4.00")
    assert expense_total(client, headers) == "14.00"


def test_settle_makes_it_paid_and_moves_the_balance(client, headers):
    account_id = make_account(client, headers)
    out = create(client, headers, account_id, amount="10.00", is_paid=False)
    resp = client.post(f"{URL}/{out['id']}/settle", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["splits"][0]["is_paid"] is True
    assert balance(client, headers, account_id) == "90.00"


def test_settle_on_an_already_paid_transaction_changes_nothing(client, headers):
    account_id = make_account(client, headers)
    out = create(client, headers, account_id, amount="10.00")
    assert client.post(f"{URL}/{out['id']}/settle", headers=headers).status_code == 200
    assert balance(client, headers, account_id) == "90.00"


def test_settle_of_someone_elses_transaction_is_404(client, headers, db_session):
    account_id = make_account(client, headers)
    out = create(client, headers, account_id, is_paid=False)
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    assert client.post(f"{URL}/{out['id']}/settle", headers=other).status_code == 404


def test_ignored_still_changes_the_balance(client, headers):
    account_id = make_account(client, headers)
    create(client, headers, account_id, amount="5.00", ignored=True)
    assert balance(client, headers, account_id) == "95.00"


def test_ignored_leaves_the_expense_total(client, headers):
    account_id = make_account(client, headers)
    create(client, headers, account_id, amount="5.00", ignored=True)
    create(client, headers, account_id, amount="10.00")
    assert expense_total(client, headers) == "10.00"


def test_ignored_leaves_the_budget_spent(client, headers):
    account_id = make_account(client, headers)
    budget = {"name": "Mercado", "currency_code": "BRL", "amount": "800.00", "period": "monthly"}
    budget_id = client.post(BUDGETS_URL, json=budget, headers=headers).json()["id"]
    create(client, headers, account_id, amount="100.00", budget_id=budget_id)
    create(client, headers, account_id, amount="50.00", budget_id=budget_id, ignored=True)
    [item] = client.get(f"{BUDGETS_URL}/progress", params={"on": "2026-03-15"}, headers=headers).json()
    assert item["spent"] == "100.00"


def test_edit_can_turn_paid_and_ignored_on_and_off(client, headers):
    account_id = make_account(client, headers)
    out = create(client, headers, account_id, amount="10.00")
    body = {"splits": [split(account_id, amount="10.00", is_paid=False, ignored=True)]}
    edited = client.put(f"{URL}/{out['id']}", json=body, headers=headers).json()
    assert edited["splits"][0]["is_paid"] is False
    assert edited["splits"][0]["ignored"] is True
    assert balance(client, headers, account_id) == "100.00"

    body = {"splits": [split(account_id, amount="10.00")]}
    back = client.put(f"{URL}/{out['id']}", json=body, headers=headers).json()
    assert back["splits"][0]["is_paid"] is True
    assert back["splits"][0]["ignored"] is False
    assert balance(client, headers, account_id) == "90.00"


def test_listing_returns_the_flags(client, headers):
    account_id = make_account(client, headers)
    create(client, headers, account_id, amount="10.00", is_paid=False, ignored=True)
    [item] = client.get(URL, headers=headers).json()["items"]
    assert item["splits"][0]["is_paid"] is False
    assert item["splits"][0]["ignored"] is True
