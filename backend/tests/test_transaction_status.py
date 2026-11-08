"""Filtro de situacao das transacoes (igual ao do Mobills): efetivadas, pendentes, movimentacoes fixas e ignoradas."""

import csv
import io
from datetime import timedelta

import pytest

from tests.conftest import SESSION_TODAY, auth_headers, make_user, register

URL = "/api/v1/transactions"
RECURRENCES = "/api/v1/recurrences"
SUMMARY = "/api/v1/reports/summary"
TODAY = SESSION_TODAY
pytestmark = pytest.mark.usefixtures("frozen_today")


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


@pytest.fixture
def account_id(client, headers):
    body = {"name": "Nubank", "type": "asset", "currency_code": "BRL", "opening_balance": "5000.00"}
    return client.post("/api/v1/accounts", json=body, headers=headers).json()["id"]


def split(account_id, description, amount="10.00", **extra):
    return {
        "type": "withdrawal",
        "date": TODAY.isoformat(),
        "description": description,
        "amount": amount,
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Loja",
        **extra,
    }


def add(client, headers, account_id, description, amount="10.00", **extra):
    resp = client.post(URL, json={"splits": [split(account_id, description, amount, **extra)]}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def recurrence(client, headers, account_id, name, **overrides):
    body = {
        "name": name,
        "frequency": "monthly",
        "first_date": TODAY.isoformat(),
        "auto_create": True,
        "template": {"splits": [split(account_id, name)]},
        **overrides,
    }
    resp = client.post(RECURRENCES, json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def listed(client, headers, **params):
    resp = client.get(URL, params={"limit": 200, **params}, headers=headers)
    assert resp.status_code == 200, resp.text
    return sorted(group["splits"][0]["description"] for group in resp.json()["items"])


@pytest.fixture
def world(client, headers, account_id):
    """Um lancamento de cada situacao, todos de hoje."""
    add(client, headers, account_id, "paga", "10.00")
    add(client, headers, account_id, "pendente", "20.00", is_paid=False)
    add(client, headers, account_id, "ignorada", "5.00", ignored=True)
    recurrence(client, headers, account_id, "fixa")
    recurrence(client, headers, account_id, "repete", max_occurrences=3)
    recurrence(client, headers, account_id, "ate-uma-data", end_date=(TODAY + timedelta(days=60)).isoformat())


def test_without_status_everything_is_listed(client, headers, world):
    assert listed(client, headers) == ["ate-uma-data", "fixa", "ignorada", "paga", "pendente", "repete"]


def test_done_lists_paid_ones_including_the_ignored_one(client, headers, world):
    # Como no Mobills: a ignorada tambem esta paga, entao entra em Efetivadas
    assert listed(client, headers, status="done") == ["ate-uma-data", "fixa", "ignorada", "paga", "repete"]


def test_pending_lists_only_what_is_not_paid_yet(client, headers, world):
    assert listed(client, headers, status="pending") == ["pendente"]


def test_ignored_lists_only_ignored_ones(client, headers, world):
    assert listed(client, headers, status="ignored") == ["ignorada"]


def test_fixed_lists_only_recurrences_without_an_end(client, headers, world):
    # "Repetir" com numero de vezes ou com data final tambem e recorrencia, mas nao e fixa
    assert listed(client, headers, status="fixed") == ["fixa"]


def test_a_recurrence_that_gets_an_end_stops_being_fixed(client, headers, account_id):
    created = recurrence(client, headers, account_id, "vai-acabar")
    assert listed(client, headers, status="fixed") == ["vai-acabar"]
    patched = client.patch(f"{RECURRENCES}/{created['id']}", json={"max_occurrences": 5}, headers=headers)
    assert patched.status_code == 200, patched.text
    assert listed(client, headers, status="fixed") == []


def test_an_unknown_status_is_refused(client, headers):
    resp = client.get(URL, params={"status": "todas"}, headers=headers)
    assert resp.status_code == 422


def test_status_combines_with_the_other_filters(client, headers, account_id):
    other = client.post(
        "/api/v1/accounts",
        json={"name": "Itau", "type": "asset", "currency_code": "BRL", "opening_balance": "100.00"},
        headers=headers,
    ).json()["id"]
    add(client, headers, account_id, "nubank-pendente", is_paid=False)
    add(client, headers, other, "itau-pendente", is_paid=False)
    add(client, headers, other, "itau-paga")
    assert listed(client, headers, status="pending", account_id=other) == ["itau-pendente"]
    assert listed(client, headers, status="done", account_id=other) == ["itau-paga"]


def test_a_group_with_paid_and_unpaid_parts_shows_under_both(client, headers, account_id):
    body = {"splits": [split(account_id, "parte-paga"), split(account_id, "parte-pendente", is_paid=False)]}
    assert client.post(URL, json=body, headers=headers).status_code == 201
    assert len(listed(client, headers, status="done")) == 1
    assert len(listed(client, headers, status="pending")) == 1


def test_total_matches_the_filtered_list(client, headers, world):
    resp = client.get(URL, params={"status": "pending"}, headers=headers).json()
    assert resp["total"] == 1 and len(resp["items"]) == 1


def test_only_my_transactions_are_filtered(client, headers, account_id, db_session):
    add(client, headers, account_id, "minha-pendente", is_paid=False)
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    other_account = client.post(
        "/api/v1/accounts",
        json={"name": "Conta", "type": "asset", "currency_code": "BRL", "opening_balance": "100.00"},
        headers=other,
    ).json()["id"]
    add(client, other, other_account, "dela-pendente", is_paid=False)
    assert listed(client, headers, status="pending") == ["minha-pendente"]


# ---------- Exportacao em CSV ----------


def test_csv_export_follows_the_status(client, headers, world):
    resp = client.get(f"{URL}/export.csv", params={"status": "pending"}, headers=headers)
    assert resp.status_code == 200
    text = resp.content.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text), delimiter=";" if ";" in text.splitlines()[0] else ","))
    assert len(rows) == 2, rows
    assert "pendente" in text and "paga" not in text.replace("pendente", "")


def test_csv_export_rejects_an_unknown_status(client, headers):
    assert client.get(f"{URL}/export.csv", params={"status": "x"}, headers=headers).status_code == 422


# ---------- Resumo (cartoes da tela) ----------


def summary(client, headers, **params):
    resp = client.get(
        SUMMARY, params={"date_from": TODAY.isoformat(), "date_to": TODAY.isoformat(), **params}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    currencies = resp.json()["currencies"]
    return currencies[0] if currencies else None


def test_summary_without_status_ignores_the_ignored_ones_like_before(client, headers, world):
    total = summary(client, headers)
    # paga 10 + pendente 20 + fixa 10 + repete 10 + ate-uma-data 10; a ignorada (5) fica de fora
    assert total["expense"] == "60.00" and total["count"] == 5


def test_summary_done_and_pending_split_the_total(client, headers, world):
    assert summary(client, headers, status="done")["expense"] == "40.00"
    assert summary(client, headers, status="pending")["expense"] == "20.00"


def test_summary_fixed_counts_only_fixed_ones(client, headers, world):
    assert summary(client, headers, status="fixed")["expense"] == "10.00"


def test_summary_ignored_is_always_zero_because_ignored_never_counts(client, headers, world):
    # Como no Mobills: com o filtro Ignoradas os cartoes mostram R$ 0,00
    assert summary(client, headers, status="ignored") is None


def test_summary_rejects_an_unknown_status(client, headers):
    assert client.get(SUMMARY, params={"status": "x"}, headers=headers).status_code == 422
