"""Nome e tipo das contas na resposta, e a sugestao de contrapartes ao digitar."""

import pytest

from tests.conftest import auth_headers, make_user, register
from tests.test_transactions import URL, make_account, withdrawal
from tests.test_transactions_rules import deposit, post, transfer

COUNTERPARTIES = f"{URL}/counterparties"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def names(client, headers, kind, query=""):
    resp = client.get(f"{COUNTERPARTIES}?type={kind}{query}", headers=headers)
    assert resp.status_code == 200
    return [item["name"] for item in resp.json()]


# ---------- Nomes e tipos na resposta ----------


def test_withdrawal_shows_the_account_and_the_expense_by_name(client, headers):
    account_id = make_account(client, headers, name="Nubank")
    split = post(client, headers, withdrawal(account_id, counterparty_name="Supermercado")).json()["splits"][0]
    assert split["source_account_name"] == "Nubank"
    assert split["source_account_type"] == "asset"
    assert split["destination_account_name"] == "Supermercado"
    assert split["destination_account_type"] == "expense"


def test_deposit_shows_the_revenue_as_the_source(client, headers):
    account_id = make_account(client, headers, name="Nubank")
    split = post(client, headers, deposit(account_id, counterparty_name="Empregador")).json()["splits"][0]
    assert split["source_account_name"] == "Empregador"
    assert split["source_account_type"] == "revenue"
    assert split["destination_account_name"] == "Nubank"
    assert split["destination_account_type"] == "asset"


def test_transfer_shows_both_accounts(client, headers):
    first = make_account(client, headers, name="Conta A")
    second = make_account(client, headers, name="Conta B", opening_balance="0")
    split = post(client, headers, transfer(first, second)).json()["splits"][0]
    assert (split["source_account_name"], split["destination_account_name"]) == ("Conta A", "Conta B")
    assert (split["source_account_type"], split["destination_account_type"]) == ("asset", "asset")


def test_paying_a_debt_shows_the_liability_type(client, headers):
    account_id = make_account(client, headers, name="Nubank")
    debt = make_account(client, headers, name="Financiamento", type="liability", opening_balance="500.00")
    split = post(
        client, headers, withdrawal(account_id, counterparty_account_id=debt, counterparty_name=None)
    ).json()["splits"][0]
    assert split["destination_account_name"] == "Financiamento"
    assert split["destination_account_type"] == "liability"


def test_names_come_in_the_list_and_in_get_too(client, headers):
    account_id = make_account(client, headers, name="Nubank")
    created = post(client, headers, withdrawal(account_id, counterparty_name="Padaria")).json()
    from_list = client.get(URL, headers=headers).json()["items"][0]["splits"][0]
    from_get = client.get(f"{URL}/{created['id']}", headers=headers).json()["splits"][0]
    for split in (from_list, from_get):
        assert split["destination_account_name"] == "Padaria"


def test_renaming_an_account_is_reflected_in_old_transactions(client, headers):
    account_id = make_account(client, headers, name="Nubank")
    post(client, headers, withdrawal(account_id))
    client.patch(f"/api/v1/accounts/{account_id}", json={"name": "Nubank Roxinho"}, headers=headers)
    split = client.get(URL, headers=headers).json()["items"][0]["splits"][0]
    assert split["source_account_name"] == "Nubank Roxinho"


# ---------- Sugestao de contrapartes ----------


def test_counterparties_require_login(client):
    assert client.get(f"{COUNTERPARTIES}?type=expense").status_code == 401


def test_the_route_is_not_confused_with_a_transaction_id(client, headers):
    resp = client.get(f"{COUNTERPARTIES}?type=expense", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_suggests_the_expenses_already_used_in_alphabetical_order(client, headers):
    account_id = make_account(client, headers)
    for name in ["padaria", "Supermercado", "Açougue", "Feira"]:
        post(client, headers, withdrawal(account_id, counterparty_name=name))
    assert names(client, headers, "expense") == ["Açougue", "Feira", "padaria", "Supermercado"]


def test_expense_and_revenue_lists_are_separate(client, headers):
    account_id = make_account(client, headers)
    post(client, headers, withdrawal(account_id, counterparty_name="Supermercado"))
    post(client, headers, deposit(account_id, counterparty_name="Empregador"))
    assert names(client, headers, "expense") == ["Supermercado"]
    assert names(client, headers, "revenue") == ["Empregador"]


def test_own_accounts_and_system_accounts_are_never_suggested(client, headers):
    make_account(client, headers, name="Nubank", opening_balance="100.00")
    assert names(client, headers, "expense") == []
    assert names(client, headers, "revenue") == []


def test_search_matches_part_of_the_name_ignoring_case(client, headers):
    account_id = make_account(client, headers)
    for name in ["Supermercado", "Mercado Livre", "Padaria"]:
        post(client, headers, withdrawal(account_id, counterparty_name=name))
    assert names(client, headers, "expense", "&q=MERCA") == ["Mercado Livre", "Supermercado"]
    assert names(client, headers, "expense", "&q=zzz") == []


def test_percent_in_the_search_is_plain_text(client, headers):
    account_id = make_account(client, headers)
    post(client, headers, withdrawal(account_id, counterparty_name="Loja"))
    assert names(client, headers, "expense", "&q=%25") == []


def test_the_limit_is_respected_and_validated(client, headers):
    account_id = make_account(client, headers)
    for index in range(5):
        post(client, headers, withdrawal(account_id, counterparty_name=f"Loja {index}"))
    assert len(names(client, headers, "expense", "&limit=3")) == 3
    assert client.get(f"{COUNTERPARTIES}?type=expense&limit=0", headers=headers).status_code == 422
    assert client.get(f"{COUNTERPARTIES}?type=expense&limit=51", headers=headers).status_code == 422


@pytest.mark.parametrize("kind", ["asset", "initial_balance", "banana", ""])
def test_only_expense_and_revenue_are_accepted(client, headers, kind):
    assert client.get(f"{COUNTERPARTIES}?type={kind}", headers=headers).status_code == 422


def test_type_is_required(client, headers):
    assert client.get(COUNTERPARTIES, headers=headers).status_code == 422


def test_suggestions_never_cross_users(client, headers, db_session):
    account_id = make_account(client, headers)
    post(client, headers, withdrawal(account_id, counterparty_name="Segredo da Ana"))
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    assert names(client, other, "expense") == []
    assert names(client, other, "expense", "&q=segredo") == []
