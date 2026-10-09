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


def make_credit_card(client, headers, closing_day=28, due_day=5, **overrides):
    return make_account(client, headers, role="credit_card", closing_day=closing_day, due_day=due_day, **overrides).json()[
        "id"
    ]


def buy(client, headers, account_id, amount="300.00", on="2026-01-10", installments=None, description="Compra", **overrides):
    split = {
        "type": "withdrawal",
        "date": on,
        "description": description,
        "amount": amount,
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Loja",
        **overrides,
    }
    body = {"splits": [split]}
    if installments is not None:
        body["installments"] = installments
    return client.post(TX_URL, json=body, headers=headers)


def list_transactions(client, headers, **params):
    return client.get(TX_URL, params=params, headers=headers).json()["items"]


# ---------- Validacao ----------


def test_installments_requires_credit_card_account(client, headers):
    account_id = make_account(client, headers).json()["id"]
    resp = buy(client, headers, account_id, installments=3)
    assert resp.status_code == 400
    assert resp.json()["code"] == "account_not_credit_card"


def test_installments_requires_a_single_withdrawal_split(client, headers):
    card_id = make_credit_card(client, headers)
    other_id = make_account(client, headers, name="Conta corrente").json()["id"]
    split = {
        "type": "withdrawal",
        "date": "2026-01-10",
        "description": "Compra",
        "amount": "300.00",
        "currency_code": "BRL",
        "account_id": card_id,
        "counterparty_name": "Loja",
    }
    other_split = {**split, "account_id": other_id}
    resp = client.post(TX_URL, json={"splits": [split, other_split], "installments": 3}, headers=headers)
    assert resp.status_code == 422


def test_installments_out_of_range_is_refused(client, headers):
    card_id = make_credit_card(client, headers)
    assert buy(client, headers, card_id, installments=1).status_code == 422
    assert buy(client, headers, card_id, installments=61).status_code == 422


# ---------- Criacao das parcelas ----------


def test_buying_in_installments_creates_one_transaction_per_month(client, headers):
    card_id = make_credit_card(client, headers)
    resp = buy(client, headers, card_id, amount="300.00", on="2026-01-31", installments=3, description="Notebook")
    assert resp.status_code == 201

    items = list_transactions(client, headers, account_id=card_id)
    assert len(items) == 3

    items.sort(key=lambda item: item["splits"][0]["date"])
    expected_dates = ["2026-01-31", "2026-02-28", "2026-03-31"]
    for item, expected_date in zip(items, expected_dates, strict=True):
        assert item["splits"][0]["date"] == expected_date
        assert item["installment_count"] == 3
    assert [item["installment_index"] for item in items] == [0, 1, 2]
    assert [item["splits"][0]["description"] for item in items] == [
        "Notebook (1/3)",
        "Notebook (2/3)",
        "Notebook (3/3)",
    ]
    assert sum(float(item["splits"][0]["amount"]) for item in items) == 300.00


def test_response_is_the_first_installment(client, headers):
    card_id = make_credit_card(client, headers)
    resp = buy(client, headers, card_id, amount="300.00", on="2026-01-10", installments=3)
    assert resp.status_code == 201
    body = resp.json()
    assert body["installment_index"] == 0
    assert body["installment_count"] == 3


def test_regular_purchase_has_no_installment_fields(client, headers):
    card_id = make_credit_card(client, headers)
    body = buy(client, headers, card_id).json()
    assert body["installment_index"] is None
    assert body["installment_count"] is None
