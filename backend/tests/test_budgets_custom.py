"""Orcamento personalizado: periodo por datas, categorias que contam para o limite, alerta e o selo de expirado."""

import pytest

from tests.conftest import auth_headers, make_user, register
from tests.test_budgets import URL, make_account, make_budget, progress, spend


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def category(client, headers, name="Mercado", kind="expense"):
    resp = client.post("/api/v1/categories", json={"name": name, "kind": kind, "color": "#00A878", "icon": "house"}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def custom(client, headers, **overrides):
    body = {"name": "Viagem", "period": "custom", "start_date": "2026-03-01", "end_date": "2026-03-31", **overrides}
    return make_budget(client, headers, **body)


def item(client, headers, name, **params):
    found = [row for row in progress(client, headers, **params).json() if row["name"] == name]
    assert len(found) == 1
    return found[0]


# ---------- Criar e validar ----------


def test_create_a_custom_budget_with_categories_and_alert(client, headers):
    mercado = category(client, headers)
    resp = custom(client, headers, category_ids=[mercado], alert=True)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["period"] == "custom"
    assert (body["start_date"], body["end_date"]) == ("2026-03-01", "2026-03-31")
    assert body["category_ids"] == [mercado]
    assert body["alert"] is True


def test_old_style_budgets_come_back_without_dates_categories_or_alert(client, headers):
    body = make_budget(client, headers).json()
    assert (body["start_date"], body["end_date"], body["category_ids"], body["alert"]) == (None, None, [], False)


@pytest.mark.parametrize(
    "overrides",
    [
        {"start_date": None, "end_date": None},
        {"end_date": None},
        {"start_date": "2026-04-01", "end_date": "2026-03-01"},
        {"period": "monthly"},
        {"period": "monthly", "start_date": None, "end_date": "2026-03-31"},
    ],
)
def test_dates_follow_the_period(client, headers, overrides):
    assert custom(client, headers, **overrides).status_code == 422


def test_a_one_day_period_is_allowed(client, headers):
    assert custom(client, headers, start_date="2026-03-10", end_date="2026-03-10").status_code == 201


def test_carry_over_is_not_allowed_in_a_custom_period(client, headers):
    assert custom(client, headers, carry_over=True).status_code == 422


def test_only_expense_categories_are_accepted(client, headers):
    renda = category(client, headers, name="Salario", kind="revenue")
    resp = custom(client, headers, category_ids=[renda])
    assert resp.status_code == 400 and resp.json()["code"] == "category_kind_mismatch"


def test_a_category_of_another_user_is_refused(client, headers, db_session):
    other = make_user(db_session, email="outra@example.com")
    other_headers = auth_headers(client, email=other.email)
    foreign = category(client, other_headers, name="Dela")
    resp = custom(client, headers, category_ids=[foreign])
    assert resp.status_code == 404 and resp.json()["code"] == "category_not_found"


def test_repeated_categories_are_saved_once(client, headers):
    mercado = category(client, headers)
    body = custom(client, headers, category_ids=[mercado, mercado]).json()
    assert body["category_ids"] == [mercado]


# ---------- O gasto ----------


def test_spending_comes_from_the_categories_inside_the_dates(client, headers):
    mercado = category(client, headers)
    account_id = make_account(client, headers)
    custom(client, headers, amount="500.00", category_ids=[mercado])

    spend(client, headers, account_id, None, amount="120.00", on="2026-03-05", category_id=mercado)
    spend(client, headers, account_id, None, amount="30.00", on="2026-03-31", category_id=mercado)
    # Fora do intervalo, sem categoria e em outra categoria nao contam
    spend(client, headers, account_id, None, amount="999.00", on="2026-04-01", category_id=mercado)
    spend(client, headers, account_id, None, amount="999.00", on="2026-02-28", category_id=mercado)
    spend(client, headers, account_id, None, amount="999.00", on="2026-03-10")
    spend(client, headers, account_id, None, amount="999.00", on="2026-03-10", category_id=category(client, headers, name="Lazer"))

    row = item(client, headers, "Viagem", on="2026-03-15")
    assert (row["spent"], row["remaining"], row["percent"]) == ("150.00", "350.00", 30)
    assert (row["period_start"], row["period_end"]) == ("2026-03-01", "2026-03-31")


def test_the_period_is_the_same_whatever_date_is_asked(client, headers):
    mercado = category(client, headers)
    account_id = make_account(client, headers)
    custom(client, headers, category_ids=[mercado])
    spend(client, headers, account_id, None, amount="80.00", on="2026-03-12", category_id=mercado)

    for on in ("2026-01-01", "2026-03-12", "2026-09-30"):
        row = item(client, headers, "Viagem", on=on)
        assert row["spent"] == "80.00"
        assert (row["period_start"], row["period_end"]) == ("2026-03-01", "2026-03-31")


def test_a_linked_transaction_in_a_budget_category_counts_once(client, headers):
    mercado = category(client, headers)
    account_id = make_account(client, headers)
    budget_id = custom(client, headers, category_ids=[mercado]).json()["id"]

    # Ligado ao orcamento e tambem na categoria dele: uma vez so
    spend(client, headers, account_id, budget_id, amount="100.00", on="2026-03-10", category_id=mercado)
    # So ligado (sem categoria) e so na categoria (sem ligar) tambem contam, cada um uma vez
    spend(client, headers, account_id, budget_id, amount="40.00", on="2026-03-11")
    spend(client, headers, account_id, None, amount="10.00", on="2026-03-12", category_id=mercado)

    assert item(client, headers, "Viagem")["spent"] == "150.00"


def test_a_budget_without_categories_only_counts_linked_transactions(client, headers):
    mercado = category(client, headers)
    account_id = make_account(client, headers)
    budget_id = custom(client, headers).json()["id"]
    spend(client, headers, account_id, None, amount="500.00", on="2026-03-10", category_id=mercado)
    spend(client, headers, account_id, budget_id, amount="25.00", on="2026-03-10")
    assert item(client, headers, "Viagem")["spent"] == "25.00"


def test_categories_only_count_spending_in_the_budget_currency(client, headers):
    mercado = category(client, headers)
    usd_account = make_account(client, headers, name="Wise", currency_code="USD")
    brl_account = make_account(client, headers)
    custom(client, headers, category_ids=[mercado])
    spend(client, headers, usd_account, None, amount="300.00", on="2026-03-10", category_id=mercado, currency_code="USD")
    spend(client, headers, brl_account, None, amount="60.00", on="2026-03-10", category_id=mercado)
    assert item(client, headers, "Viagem")["spent"] == "60.00"


def test_ignored_spending_and_deposits_do_not_count(client, headers):
    mercado = category(client, headers)
    account_id = make_account(client, headers)
    custom(client, headers, category_ids=[mercado])
    spend(client, headers, account_id, None, amount="70.00", on="2026-03-10", category_id=mercado, ignored=True)
    spend(client, headers, account_id, None, amount="90.00", on="2026-03-10", category_id=mercado, type="deposit")
    spend(client, headers, account_id, None, amount="20.00", on="2026-03-10", category_id=mercado)
    assert item(client, headers, "Viagem")["spent"] == "20.00"


def test_two_budgets_can_count_the_same_category(client, headers):
    mercado = category(client, headers)
    account_id = make_account(client, headers)
    custom(client, headers, name="Marco", category_ids=[mercado])
    make_budget(client, headers, name="Mensal", category_ids=[mercado])
    spend(client, headers, account_id, None, amount="50.00", on="2026-03-10", category_id=mercado)
    assert item(client, headers, "Marco", on="2026-03-15")["spent"] == "50.00"
    assert item(client, headers, "Mensal", on="2026-03-15")["spent"] == "50.00"


def test_monthly_budgets_with_categories_count_them_and_carry_the_leftover(client, headers):
    mercado = category(client, headers)
    account_id = make_account(client, headers)
    make_budget(client, headers, name="Mensal", amount="500.00", carry_over=True, category_ids=[mercado])
    spend(client, headers, account_id, None, amount="200.00", on="2026-02-10", category_id=mercado)
    spend(client, headers, account_id, None, amount="100.00", on="2026-03-10", category_id=mercado)

    row = item(client, headers, "Mensal", on="2026-03-15")
    # Fevereiro sobrou 300,00: marco tem 800,00 de limite e 100,00 gastos
    assert (row["limit"], row["spent"], row["remaining"]) == ("800.00", "100.00", "700.00")


# ---------- Expirados ----------


def test_only_a_finished_custom_period_is_expired(client, headers):
    custom(client, headers, name="Passou", start_date="2026-01-01", end_date="2026-01-31")
    custom(client, headers, name="Em curso", start_date="2026-03-01", end_date="2026-03-31")
    custom(client, headers, name="Futuro", start_date="2026-05-01", end_date="2026-05-31")
    make_budget(client, headers, name="Mensal")

    flags = {row["name"]: row["expired"] for row in progress(client, headers, on="2026-03-15").json()}
    assert flags == {"Passou": True, "Em curso": False, "Futuro": False, "Mensal": False}
    # No ultimo dia ainda vale
    assert item(client, headers, "Em curso", on="2026-03-31")["expired"] is False
    assert item(client, headers, "Em curso", on="2026-04-01")["expired"] is True


# ---------- Editar ----------


def test_patch_replaces_and_clears_the_categories(client, headers):
    mercado = category(client, headers)
    lazer = category(client, headers, name="Lazer")
    budget_id = custom(client, headers, category_ids=[mercado]).json()["id"]

    resp = client.patch(f"{URL}/{budget_id}", json={"category_ids": [lazer]}, headers=headers)
    assert resp.json()["category_ids"] == [lazer]
    # Sem o campo: nao mexe
    assert client.patch(f"{URL}/{budget_id}", json={"alert": True}, headers=headers).json()["category_ids"] == [lazer]
    # Lista vazia: tira todas
    assert client.patch(f"{URL}/{budget_id}", json={"category_ids": []}, headers=headers).json()["category_ids"] == []


def test_patch_validates_the_new_categories(client, headers):
    renda = category(client, headers, name="Salario", kind="revenue")
    budget_id = custom(client, headers).json()["id"]
    resp = client.patch(f"{URL}/{budget_id}", json={"category_ids": [renda]}, headers=headers)
    assert resp.status_code == 400 and resp.json()["code"] == "category_kind_mismatch"


def test_patch_changes_the_dates_and_keeps_them_in_order(client, headers):
    budget_id = custom(client, headers).json()["id"]
    resp = client.patch(f"{URL}/{budget_id}", json={"end_date": "2026-06-30"}, headers=headers)
    assert (resp.json()["start_date"], resp.json()["end_date"]) == ("2026-03-01", "2026-06-30")
    assert client.patch(f"{URL}/{budget_id}", json={"end_date": "2026-02-01"}, headers=headers).status_code == 422


def test_patch_to_custom_needs_dates_and_away_from_custom_clears_them(client, headers):
    monthly_id = make_budget(client, headers, name="Mensal").json()["id"]
    assert client.patch(f"{URL}/{monthly_id}", json={"period": "custom"}, headers=headers).status_code == 422
    resp = client.patch(
        f"{URL}/{monthly_id}", json={"period": "custom", "start_date": "2026-03-01", "end_date": "2026-03-10"}, headers=headers
    )
    assert resp.status_code == 200 and resp.json()["period"] == "custom"

    back = client.patch(f"{URL}/{monthly_id}", json={"period": "weekly"}, headers=headers)
    assert back.status_code == 200
    assert (back.json()["start_date"], back.json()["end_date"]) == (None, None)


def test_deleting_a_category_takes_it_out_of_the_budget(client, headers):
    mercado = category(client, headers)
    lazer = category(client, headers, name="Lazer")
    budget_id = custom(client, headers, category_ids=[mercado, lazer]).json()["id"]
    assert client.delete(f"/api/v1/categories/{mercado}", headers=headers).status_code == 204
    assert client.get(f"{URL}/{budget_id}", headers=headers).json()["category_ids"] == [lazer]


def test_deleting_the_budget_keeps_the_category(client, headers):
    mercado = category(client, headers)
    budget_id = custom(client, headers, category_ids=[mercado]).json()["id"]
    assert client.delete(f"{URL}/{budget_id}", headers=headers).status_code == 204
    assert client.get(f"/api/v1/categories/{mercado}", headers=headers).status_code == 200


def test_list_returns_dates_and_categories(client, headers):
    mercado = category(client, headers)
    custom(client, headers, category_ids=[mercado], alert=True)
    body = client.get(URL, headers=headers).json()["items"][0]
    assert (body["start_date"], body["category_ids"], body["alert"]) == ("2026-03-01", [mercado], True)
