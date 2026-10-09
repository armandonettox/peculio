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


def spend(client, headers, account_id, amount="50.00", on="2026-01-10", description="Compra", type="withdrawal", **overrides):
    split = {
        "type": type,
        "date": on,
        "description": description,
        "amount": amount,
        "currency_code": "BRL",
        "account_id": account_id,
        **({"counterparty_name": "Loja"} if type != "deposit" else {}),
        **({"counterparty_name": "Estorno"} if type == "deposit" else {}),
        **overrides,
    }
    return client.post(TX_URL, json={"splits": [split]}, headers=headers)


def invoice(client, headers, account_id, **params):
    return client.get(f"{ACCOUNTS_URL}/{account_id}/invoice", params=params, headers=headers)


# ---------- Validacao da conta ----------


def test_requires_login(client):
    assert client.get(f"{ACCOUNTS_URL}/{'0' * 8}-0000-0000-0000-{'0' * 12}/invoice").status_code == 401


def test_closing_day_and_due_day_must_come_together(client, headers):
    resp = make_account(client, headers, role="credit_card", closing_day=28)
    assert resp.status_code == 422

    resp = make_account(client, headers, role="credit_card", due_day=5)
    assert resp.status_code == 422


def test_closing_day_only_valid_for_credit_card_role(client, headers):
    resp = make_account(client, headers, role="checking", closing_day=28, due_day=5)
    assert resp.status_code == 422


def test_invoice_of_an_account_without_closing_day_is_refused(client, headers):
    account_id = make_account(client, headers).json()["id"]
    resp = invoice(client, headers, account_id)
    assert resp.status_code == 400
    assert resp.json()["code"] == "account_not_credit_card"


# ---------- Periodo e total ----------


def test_invoice_sums_only_the_withdrawals_in_the_period(client, headers):
    account_id = make_credit_card(client, headers, closing_day=28, due_day=5)
    # Dentro do periodo que fecha em 28/01
    spend(client, headers, account_id, amount="100.00", on="2026-01-10")
    spend(client, headers, account_id, amount="50.00", on="2026-01-28")
    # Fora: cai no periodo seguinte (fecha em 28/02)
    spend(client, headers, account_id, amount="999.00", on="2026-01-29")

    resp = invoice(client, headers, account_id, on="2026-01-15")
    assert resp.status_code == 200
    body = resp.json()
    assert body["period_start"] == "2025-12-29"
    assert body["period_end"] == "2026-01-28"
    assert body["due_date"] == "2026-02-05"
    assert body["total"] == "150.00"
    assert len(body["splits"]) == 2


def test_invoice_ignores_deposits_and_other_accounts(client, headers):
    account_id = make_credit_card(client, headers, closing_day=28, due_day=5)
    other_id = make_credit_card(client, headers, name="Outro cartao", closing_day=28, due_day=5)
    spend(client, headers, account_id, amount="100.00", on="2026-01-10")
    # Estorno recebido no cartao: nao e gasto, nao soma
    spend(client, headers, account_id, amount="30.00", on="2026-01-12", type="deposit")
    # Gasto no OUTRO cartao: nao aparece aqui
    spend(client, headers, other_id, amount="999.00", on="2026-01-10")

    body = invoice(client, headers, account_id, on="2026-01-15").json()
    assert body["total"] == "100.00"
    assert len(body["splits"]) == 1


def test_next_invoice_has_the_correct_period(client, headers):
    account_id = make_credit_card(client, headers, closing_day=28, due_day=5)
    spend(client, headers, account_id, amount="100.00", on="2026-02-01")

    body = invoice(client, headers, account_id, on="2026-02-15").json()
    assert body["period_start"] == "2026-01-29"
    assert body["period_end"] == "2026-02-28"
    assert body["due_date"] == "2026-03-05"
    assert body["total"] == "100.00"
