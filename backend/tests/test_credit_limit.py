import pytest

from tests.conftest import auth_headers, register

ACCOUNTS_URL = "/api/v1/accounts"
TX_URL = "/api/v1/transactions"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_account(client, headers, **overrides):
    body = {"name": "Cartao", "type": "asset", "currency_code": "BRL", **overrides}
    return client.post(ACCOUNTS_URL, json=body, headers=headers)


def make_credit_card(client, headers, credit_limit="1000.00", **overrides):
    return make_account(
        client, headers, role="credit_card", closing_day=28, due_day=5, credit_limit=credit_limit, **overrides
    ).json()["id"]


def spend(client, headers, account_id, amount="50.00", on="2026-01-10"):
    split = {
        "type": "withdrawal",
        "date": on,
        "description": "Compra",
        "amount": amount,
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Loja",
    }
    return client.post(TX_URL, json={"splits": [split]}, headers=headers)


# ---------- Criacao ----------


def test_create_credit_card_with_limit(client, headers):
    resp = make_account(client, headers, role="credit_card", closing_day=28, due_day=5, credit_limit="1500.00")
    assert resp.status_code == 201
    body = resp.json()
    assert body["credit_limit"] == "1500.00"


def test_credit_card_without_limit_is_allowed(client, headers):
    account_id = make_account(client, headers, role="credit_card", closing_day=28, due_day=5).json()["id"]
    assert client.get(f"{ACCOUNTS_URL}/{account_id}", headers=headers).json()["credit_limit"] is None


def test_limit_only_valid_for_credit_card_role(client, headers):
    resp = make_account(client, headers, role="checking", credit_limit="1000.00")
    assert resp.status_code == 422


def test_limit_must_be_positive(client, headers):
    resp = make_account(client, headers, role="credit_card", closing_day=28, due_day=5, credit_limit="0")
    assert resp.status_code == 422
    resp = make_account(client, headers, role="credit_card", closing_day=28, due_day=5, credit_limit="-100.00")
    assert resp.status_code == 422


# ---------- Edicao ----------


def test_set_and_clear_the_limit(client, headers):
    account_id = make_credit_card(client, headers, credit_limit="1000.00")

    resp = client.patch(f"{ACCOUNTS_URL}/{account_id}", json={"credit_limit": "2000.00"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["credit_limit"] == "2000.00"

    resp = client.patch(f"{ACCOUNTS_URL}/{account_id}", json={"credit_limit": None}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["credit_limit"] is None


def test_omitting_the_limit_on_update_keeps_it(client, headers):
    account_id = make_credit_card(client, headers, credit_limit="1000.00")
    resp = client.patch(f"{ACCOUNTS_URL}/{account_id}", json={"name": "Cartao novo"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["credit_limit"] == "1000.00"


def test_setting_the_limit_on_a_non_credit_card_account_is_rejected(client, headers):
    account_id = make_account(client, headers).json()["id"]
    resp = client.patch(f"{ACCOUNTS_URL}/{account_id}", json={"credit_limit": "500.00"}, headers=headers)
    assert resp.status_code == 400
    assert resp.json()["code"] == "validation_error"


# ---------- Limite disponivel (balance + credit_limit, calculado pelo front) ----------


def test_balance_drops_right_away_with_the_full_purchase_even_when_installments_are_in_the_future(client, headers):
    """O limite usa o balance, que soma todos os splits sem olhar a data: uma compra parcelada
    ja desconta o valor inteiro na hora, nao so a parcela deste mes."""
    account_id = make_credit_card(client, headers, credit_limit="1000.00")
    resp = client.post(
        TX_URL,
        json={
            "splits": [
                {
                    "type": "withdrawal",
                    "date": "2026-01-10",
                    "description": "Notebook",
                    "amount": "300.00",
                    "currency_code": "BRL",
                    "account_id": account_id,
                    "counterparty_name": "Loja",
                }
            ],
            "installments": 3,
        },
        headers=headers,
    )
    assert resp.status_code == 201

    body = client.get(f"{ACCOUNTS_URL}/{account_id}", headers=headers).json()
    assert body["balance"] == "-300.00"
    assert body["credit_limit"] == "1000.00"
