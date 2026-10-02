from datetime import date, timedelta

import pytest

from app.core import clock

from tests.conftest import auth_headers, register

URL = "/api/v1/recurrences"
FUTURE = (clock.today() + timedelta(days=10)).isoformat()


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


@pytest.fixture
def account_id(client, headers):
    body = {"name": "Nubank", "type": "asset", "currency_code": "BRL", "opening_balance": "5000.00"}
    return client.post("/api/v1/accounts", json=body, headers=headers).json()["id"]


def make(client, headers, account_id, **split_extra):
    split = {
        "type": "withdrawal",
        "date": "2026-01-01",
        "description": "Aluguel",
        "amount": "1000.00",
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Imobiliaria",
        **split_extra,
    }
    body = {"name": "Aluguel", "frequency": "monthly", "first_date": FUTURE, "template": {"splits": [split]}}
    return client.post(URL, json=body, headers=headers)


def stored_split(client, headers, recurrence):
    fetched = client.get(f"{URL}/{recurrence['id']}", headers=headers).json()
    listed = client.get(URL, headers=headers).json()["items"][0]
    created_split = recurrence["template"]["splits"][0]
    # Criar, buscar uma e listar devolvem o modelo igual
    assert fetched["template"] == listed["template"] == recurrence["template"]
    return created_split


def test_a_template_without_bill_id_comes_back_without_it(client, headers, account_id):
    split = stored_split(client, headers, make(client, headers, account_id).json())
    assert "bill_id" not in split


def test_a_template_with_null_bill_id_comes_back_with_null(client, headers, account_id):
    split = stored_split(client, headers, make(client, headers, account_id, bill_id=None).json())
    assert "bill_id" in split and split["bill_id"] is None


def test_a_template_with_a_bill_id_keeps_it(client, headers, account_id):
    bill = client.post(
        "/api/v1/bills",
        json={"name": "Conta", "currency_code": "BRL", "amount_min": "10.00", "amount_max": "2000.00",
              "first_due_date": FUTURE, "frequency": "monthly"},
        headers=headers,
    ).json()["id"]
    split = stored_split(client, headers, make(client, headers, account_id, bill_id=bill).json())
    assert split["bill_id"] == bill


def test_the_top_level_fields_always_come_back(client, headers, account_id):
    body = make(client, headers, account_id).json()
    for field in ("end_date", "max_occurrences", "next_date", "last_error", "created_count", "ended", "active"):
        assert field in body
    assert body["end_date"] is None and body["max_occurrences"] is None and body["last_error"] is None
