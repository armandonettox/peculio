import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core import clock
from app.models.budget import BudgetAllocation
from tests.conftest import auth_headers, make_user, register

API = "/api/v1"
ENVELOPES = f"{API}/envelopes"
BUDGETS = f"{API}/budgets"
ACCOUNTS = f"{API}/accounts"
TX = f"{API}/transactions"
PIGGY = f"{API}/piggy-banks"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_account(client, headers, **overrides):
    body = {"name": "Nubank", "type": "asset", "currency_code": "BRL", "opening_balance": "1000.00", "opening_balance_date": "2026-01-01", **overrides}
    response = client.post(ACCOUNTS, json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.fixture
def account_id(client, headers):
    return make_account(client, headers)


def make_envelope(client, headers, name="Mercado", currency="BRL", **extra):
    body = {"name": name, "currency_code": currency, "mode": "envelope", **extra}
    response = client.post(BUDGETS, json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def make_fixed(client, headers, name="Lazer", currency="BRL"):
    body = {"name": name, "currency_code": currency, "amount": "400.00", "period": "monthly"}
    return client.post(BUDGETS, json=body, headers=headers).json()["id"]


def spend(client, headers, account_id, budget_id, amount="50.00", on="2026-03-10", kind="withdrawal", currency="BRL"):
    split = {
        "type": kind, "date": on, "description": "Compra", "amount": amount, "currency_code": currency,
        "account_id": account_id, "counterparty_name": "Loja",
    }
    if budget_id is not None and kind == "withdrawal":
        split["budget_id"] = budget_id
    response = client.post(TX, json={"splits": [split]}, headers=headers)
    assert response.status_code == 201, response.text
    return response


def allocate(client, headers, budget_id, month, amount):
    return client.put(f"{ENVELOPES}/{budget_id}/{month}", json={"amount": amount}, headers=headers)


def month_view(client, headers, month="2026-03"):
    response = client.get(ENVELOPES, params={"month": month}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def group(client, headers, month="2026-03", currency="BRL"):
    return next(g for g in month_view(client, headers, month)["groups"] if g["currency_code"] == currency)


def envelope(client, headers, name, month="2026-03", currency="BRL"):
    return next(e for e in group(client, headers, month, currency)["envelopes"] if e["name"] == name)


# ---------- Contas ----------


def test_an_account_enters_the_envelopes_by_default_and_can_be_switched(client, headers, account_id):
    assert client.get(f"{ACCOUNTS}/{account_id}", headers=headers).json()["in_envelopes"] is True
    off = make_account(client, headers, name="Poupanca longa", in_envelopes=False)
    assert client.get(f"{ACCOUNTS}/{off}", headers=headers).json()["in_envelopes"] is False
    changed = client.patch(f"{ACCOUNTS}/{account_id}", json={"in_envelopes": False}, headers=headers).json()
    assert changed["in_envelopes"] is False
    assert client.patch(f"{ACCOUNTS}/{account_id}", json={"in_envelopes": True}, headers=headers).json()["in_envelopes"] is True
    # Campo vazio nao muda nada
    assert client.patch(f"{ACCOUNTS}/{account_id}", json={"in_envelopes": None, "notes": "x"}, headers=headers).json()["in_envelopes"] is True


# ---------- Orcamentos: modo ----------


def test_a_budget_is_fixed_by_default_and_an_envelope_has_no_limit(client, headers):
    fixed = client.post(BUDGETS, json={"name": "Lazer", "currency_code": "BRL", "amount": "400.00", "period": "weekly"}, headers=headers).json()
    assert fixed["mode"] == "fixed" and fixed["amount"] == "400.00" and fixed["period"] == "weekly"
    created = client.post(BUDGETS, json={"name": "Mercado", "currency_code": "BRL", "mode": "envelope"}, headers=headers)
    assert created.status_code == 201
    body = created.json()
    assert body["mode"] == "envelope" and body["amount"] is None and body["period"] == "monthly"


def test_an_envelope_accepts_an_explicit_monthly_period(client, headers):
    created = client.post(BUDGETS, json={"name": "M", "currency_code": "BRL", "mode": "envelope", "period": "monthly"}, headers=headers)
    assert created.status_code == 201


@pytest.mark.parametrize(
    "body",
    [
        {"mode": "envelope", "amount": "100.00"},
        {"mode": "envelope", "period": "weekly"},
        {"mode": "envelope", "period": "yearly"},
        {"mode": "fixed"},
        {"mode": "fixed", "amount": "100.00"},
        {"mode": "fixed", "period": "monthly"},
        {"amount": "100.00"},
        {"mode": "outro"},
    ],
)
def test_budget_mode_validation_returns_422(client, headers, body):
    response = client.post(BUDGETS, json={"name": "X", "currency_code": "BRL", **body}, headers=headers)
    assert response.status_code == 422 and response.json()["code"] == "validation_error"


def test_an_envelope_cannot_get_a_limit_or_period_later_and_the_mode_never_changes(client, headers):
    envelope_id = make_envelope(client, headers)
    for body in ({"amount": "100.00"}, {"period": "weekly"}):
        response = client.patch(f"{BUDGETS}/{envelope_id}", json=body, headers=headers)
        assert response.status_code == 422 and response.json()["code"] == "validation_error"
    assert client.patch(f"{BUDGETS}/{envelope_id}", json={"mode": "fixed"}, headers=headers).status_code == 422
    renamed = client.patch(f"{BUDGETS}/{envelope_id}", json={"name": "Supermercado"}, headers=headers)
    assert renamed.status_code == 200 and renamed.json()["name"] == "Supermercado" and renamed.json()["amount"] is None


def test_a_fixed_budget_still_edits_its_limit(client, headers):
    fixed = make_fixed(client, headers)
    assert client.patch(f"{BUDGETS}/{fixed}", json={"amount": "500.00"}, headers=headers).json()["amount"] == "500.00"


def test_envelopes_are_listed_but_have_no_progress(client, headers):
    envelope_id = make_envelope(client, headers, name="Mercado")
    fixed = make_fixed(client, headers, name="Lazer")
    listed = {item["name"]: item for item in client.get(BUDGETS, headers=headers).json()["items"]}
    assert listed["Mercado"]["mode"] == "envelope" and listed["Lazer"]["mode"] == "fixed"
    progress = client.get(f"{BUDGETS}/progress", params={"on": "2026-03-10"}, headers=headers).json()
    assert [item["id"] for item in progress] == [fixed]
    assert envelope_id not in [item["id"] for item in progress]


def test_a_transaction_can_still_be_linked_to_an_envelope(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    created = spend(client, headers, account_id, envelope_id)
    assert created.json()["splits"][0]["budget_id"] == envelope_id


# ---------- Ver o mes ----------


def test_requires_login(client):
    assert client.get(ENVELOPES).status_code == 401
    assert client.put(f"{ENVELOPES}/{uuid.uuid4()}/2026-03", json={"amount": "1"}).status_code == 401
    assert client.post(f"{ENVELOPES}/move", json={}).status_code == 401


def test_without_envelopes_the_month_is_empty(client, headers, account_id):
    make_fixed(client, headers)
    assert month_view(client, headers) == {"month": "2026-03-01", "groups": []}


def test_the_default_month_is_the_current_one(client, headers):
    body = client.get(ENVELOPES, headers=headers).json()
    assert body["month"] == clock.today().replace(day=1).isoformat()


def test_a_new_envelope_starts_at_zero_with_all_the_money_to_budget(client, headers, account_id):
    make_envelope(client, headers)
    found = group(client, headers)
    assert (found["money"], found["in_envelopes"], found["to_budget"]) == ("1000.00", "0.00", "1000.00")
    assert envelope(client, headers, "Mercado") == {
        "budget_id": envelope(client, headers, "Mercado")["budget_id"], "name": "Mercado",
        "carried": "0.00", "allocated": "0.00", "spent": "0.00", "available": "0.00", "overspent": "0.00",
        "template": None, "goal": None,
    }


def test_allocating_moves_money_from_to_budget_into_the_envelope(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    response = allocate(client, headers, envelope_id, "2026-03", "300.00")
    assert response.status_code == 200
    found = response.json()["groups"][0]
    assert (found["money"], found["in_envelopes"], found["to_budget"]) == ("1000.00", "300.00", "700.00")
    assert found["envelopes"][0]["allocated"] == "300.00" and found["envelopes"][0]["available"] == "300.00"


def test_spending_from_an_envelope_lowers_it_but_not_to_budget(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    allocate(client, headers, envelope_id, "2026-03", "300.00")
    spend(client, headers, account_id, envelope_id, "120.00", on="2026-03-15")
    found = group(client, headers)
    assert (found["money"], found["in_envelopes"], found["to_budget"]) == ("880.00", "180.00", "700.00")
    item = found["envelopes"][0]
    assert (item["spent"], item["available"], item["overspent"]) == ("120.00", "180.00", "0.00")


def test_what_is_left_carries_to_the_next_month(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    allocate(client, headers, envelope_id, "2026-03", "300.00")
    spend(client, headers, account_id, envelope_id, "100.00", on="2026-03-15")
    allocate(client, headers, envelope_id, "2026-04", "50.00")
    april = envelope(client, headers, "Mercado", "2026-04")
    assert (april["carried"], april["allocated"], april["spent"], april["available"]) == ("200.00", "50.00", "0.00", "250.00")
    assert group(client, headers, "2026-04")["to_budget"] == "650.00"
    # E o mes anterior continua como era
    assert envelope(client, headers, "Mercado", "2026-03")["available"] == "200.00"


def test_overspending_zeroes_the_envelope_and_the_excess_falls_on_to_budget(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    allocate(client, headers, envelope_id, "2026-03", "200.00")
    spend(client, headers, account_id, envelope_id, "300.00", on="2026-03-10")
    march = group(client, headers)
    item = march["envelopes"][0]
    assert (item["available"], item["overspent"]) == ("-100.00", "100.00")
    # O envelope negativo conta como zero: o excesso de 100 saiu do "A orcar" (1000 - 300 = 700 de dinheiro)
    assert (march["money"], march["in_envelopes"], march["to_budget"]) == ("700.00", "0.00", "700.00")
    april = envelope(client, headers, "Mercado", "2026-04")
    assert (april["carried"], april["available"], april["overspent"]) == ("0.00", "0.00", "0.00")


def test_distributing_more_than_there_is_is_allowed_and_to_budget_goes_negative(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    response = allocate(client, headers, envelope_id, "2026-03", "1500.00")
    assert response.status_code == 200
    assert response.json()["groups"][0]["to_budget"] == "-500.00"


def test_allocating_again_replaces_the_value_and_zero_clears_it(client, headers, account_id, db_session):
    envelope_id = make_envelope(client, headers)
    allocate(client, headers, envelope_id, "2026-03", "300.00")
    allocate(client, headers, envelope_id, "2026-03", "120.00")
    assert envelope(client, headers, "Mercado")["allocated"] == "120.00"
    assert db_session.query(BudgetAllocation).count() == 1
    allocate(client, headers, envelope_id, "2026-03", "0")
    assert envelope(client, headers, "Mercado")["allocated"] == "0.00"
    assert db_session.query(BudgetAllocation).count() == 0
    # Limpar o que nao existe nao da erro
    assert allocate(client, headers, envelope_id, "2026-03", "0.00").status_code == 200


def test_a_negative_allocation_takes_from_what_carried(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    allocate(client, headers, envelope_id, "2026-03", "100.00")
    allocate(client, headers, envelope_id, "2026-04", "-60.00")
    april = envelope(client, headers, "Mercado", "2026-04")
    assert (april["carried"], april["allocated"], april["available"]) == ("100.00", "-60.00", "40.00")
    assert group(client, headers, "2026-04")["to_budget"] == "960.00"


def test_only_withdrawals_linked_to_the_envelope_count_as_spending(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    other = make_envelope(client, headers, name="Outro")
    allocate(client, headers, envelope_id, "2026-03", "300.00")
    spend(client, headers, account_id, envelope_id, "40.00", on="2026-03-02")
    spend(client, headers, account_id, other, "25.00", on="2026-03-02")
    spend(client, headers, account_id, None, "99.00", on="2026-03-02")
    spend(client, headers, account_id, None, "500.00", on="2026-03-03", kind="deposit")
    assert envelope(client, headers, "Mercado")["spent"] == "40.00"
    assert envelope(client, headers, "Outro")["spent"] == "25.00"


def test_spending_counts_in_its_own_month_and_future_months_do_not_leak_back(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    allocate(client, headers, envelope_id, "2026-03", "300.00")
    spend(client, headers, account_id, envelope_id, "30.00", on="2026-03-31")
    spend(client, headers, account_id, envelope_id, "70.00", on="2026-04-01")
    assert envelope(client, headers, "Mercado", "2026-03")["spent"] == "30.00"
    april = envelope(client, headers, "Mercado", "2026-04")
    assert (april["spent"], april["available"]) == ("70.00", "200.00")
    assert group(client, headers, "2026-03")["money"] == "970.00"
    assert group(client, headers, "2026-04")["money"] == "900.00"


def test_spending_from_an_account_outside_the_envelopes_still_counts_for_the_envelope(client, headers, account_id):
    off = make_account(client, headers, name="Poupanca", in_envelopes=False, opening_balance="5000.00")
    envelope_id = make_envelope(client, headers)
    allocate(client, headers, envelope_id, "2026-03", "300.00")
    spend(client, headers, off, envelope_id, "80.00", on="2026-03-10")
    assert envelope(client, headers, "Mercado")["spent"] == "80.00"
    assert group(client, headers)["money"] == "1000.00"


# ---------- Dinheiro disponivel ----------


def test_only_active_asset_accounts_that_enter_the_envelopes_count_as_money(client, headers, account_id):
    make_account(client, headers, name="Fora", in_envelopes=False, opening_balance="5000.00")
    make_account(client, headers, name="Antiga", opening_balance="700.00")
    client.patch(f"{ACCOUNTS}/{next(a['id'] for a in client.get(ACCOUNTS, headers=headers).json()['items'] if a['name'] == 'Antiga')}", json={"active": False}, headers=headers)
    make_account(client, headers, name="Financiamento", type="liability", role="mortgage", opening_balance="9000.00")
    make_envelope(client, headers)
    assert group(client, headers)["money"] == "1000.00"


def test_turning_an_account_off_removes_its_money_at_once(client, headers, account_id):
    make_envelope(client, headers)
    assert group(client, headers)["money"] == "1000.00"
    client.patch(f"{ACCOUNTS}/{account_id}", json={"in_envelopes": False}, headers=headers)
    assert group(client, headers)["money"] == "0.00"


def test_money_is_the_balance_up_to_the_end_of_the_month_asked(client, headers, account_id):
    make_envelope(client, headers)
    spend(client, headers, account_id, None, "100.00", on="2026-03-31")
    spend(client, headers, account_id, None, "200.00", on="2026-04-01")
    assert group(client, headers, "2026-03")["money"] == "900.00"
    assert group(client, headers, "2026-04")["money"] == "700.00"
    # Antes de qualquer movimento do mes seguinte
    assert group(client, headers, "2026-02")["money"] == "1000.00"


def test_money_reserved_in_piggy_banks_is_not_available_to_budget(client, headers, account_id):
    make_envelope(client, headers)
    piggy = client.post(PIGGY, json={"name": "Viagem", "account_id": account_id, "target_amount": "600.00"}, headers=headers).json()["id"]
    client.post(f"{PIGGY}/{piggy}/events", json={"kind": "add", "amount": "250.00", "date": "2026-03-05"}, headers=headers)
    assert group(client, headers, "2026-03")["money"] == "750.00"
    assert group(client, headers, "2026-03")["to_budget"] == "750.00"


def test_a_piggy_deposit_made_in_a_later_month_does_not_reduce_an_earlier_one(client, headers, account_id):
    make_envelope(client, headers)
    piggy = client.post(PIGGY, json={"name": "Viagem", "account_id": account_id, "target_amount": "600.00"}, headers=headers).json()["id"]
    client.post(f"{PIGGY}/{piggy}/events", json={"kind": "add", "amount": "250.00", "date": "2026-04-05"}, headers=headers)
    assert group(client, headers, "2026-03")["money"] == "1000.00"
    assert group(client, headers, "2026-04")["money"] == "750.00"


def test_an_archived_piggy_bank_still_reserves_its_money(client, headers, account_id):
    make_envelope(client, headers)
    piggy = client.post(PIGGY, json={"name": "Velho", "account_id": account_id, "target_amount": "600.00"}, headers=headers).json()["id"]
    client.post(f"{PIGGY}/{piggy}/events", json={"kind": "add", "amount": "100.00", "date": "2026-03-05"}, headers=headers)
    client.patch(f"{PIGGY}/{piggy}", json={"active": False}, headers=headers)
    assert group(client, headers)["money"] == "900.00"


def test_each_currency_has_its_own_to_budget(client, headers, account_id):
    make_account(client, headers, name="Dolar", currency_code="USD", opening_balance="200.00")
    reais = make_envelope(client, headers, name="Mercado")
    dollars = make_envelope(client, headers, name="Viagem", currency="USD")
    allocate(client, headers, reais, "2026-03", "100.00")
    allocate(client, headers, dollars, "2026-03", "50.00")
    body = month_view(client, headers)
    assert [g["currency_code"] for g in body["groups"]] == ["BRL", "USD"]
    brl, usd = body["groups"]
    assert (brl["money"], brl["to_budget"], [e["name"] for e in brl["envelopes"]]) == ("1000.00", "900.00", ["Mercado"])
    assert (usd["money"], usd["to_budget"], [e["name"] for e in usd["envelopes"]]) == ("200.00", "150.00", ["Viagem"])


def test_a_currency_with_no_account_has_zero_money(client, headers, account_id):
    dollars = make_envelope(client, headers, name="Viagem", currency="USD")
    allocate(client, headers, dollars, "2026-03", "50.00")
    usd = group(client, headers, currency="USD")
    assert (usd["money"], usd["to_budget"]) == ("0.00", "-50.00")


def test_envelopes_are_in_alphabetical_order_and_archived_ones_are_hidden(client, headers, account_id):
    ids = {name: make_envelope(client, headers, name=name) for name in ("Zeta", "alfa", "Meio")}
    assert [e["name"] for e in group(client, headers)["envelopes"]] == ["alfa", "Meio", "Zeta"]
    allocate(client, headers, ids["Meio"], "2026-03", "100.00")
    client.patch(f"{BUDGETS}/{ids['Meio']}", json={"active": False}, headers=headers)
    assert [e["name"] for e in group(client, headers)["envelopes"]] == ["alfa", "Zeta"]
    # Arquivar solta o saldo: ele volta para o "A orcar"
    assert group(client, headers)["to_budget"] == "1000.00"


def test_the_decimal_places_follow_the_currency(client, headers):
    make_account(client, headers, name="Iene", currency_code="JPY", opening_balance="1000")
    envelope_id = make_envelope(client, headers, name="Ramen", currency="JPY")
    allocate(client, headers, envelope_id, "2026-03", "300")
    jpy = group(client, headers, currency="JPY")
    assert (jpy["money"], jpy["in_envelopes"], jpy["to_budget"]) == ("1000", "300", "700")
    refused = allocate(client, headers, envelope_id, "2026-03", "10.5")
    assert refused.status_code == 400 and refused.json()["code"] == "invalid_amount"


def test_the_view_uses_a_fixed_number_of_queries(client, headers, account_id):
    from sqlalchemy import event

    from app.core.database import engine

    for name in ("A", "B", "C", "D", "E", "F"):
        make_envelope(client, headers, name=name)
    count = 0

    def counter(*args, **kwargs):
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", counter)
    try:
        assert client.get(ENVELOPES, params={"month": "2026-03"}, headers=headers).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", counter)
    few = count
    for name in ("G", "H", "I", "J"):
        make_envelope(client, headers, name=name)
    count = 0
    event.listen(engine, "before_cursor_execute", counter)
    try:
        client.get(ENVELOPES, params={"month": "2026-03"}, headers=headers)
    finally:
        event.remove(engine, "before_cursor_execute", counter)
    assert count == few


# ---------- Mes pedido ----------


@pytest.mark.parametrize("month", ["2026-13", "2026-00", "2026-3", "26-03", "abcd", "2026-03-01", "1999-12", "2101-01", " ", "2026/03"])
def test_an_invalid_month_is_422(client, headers, month):
    response = client.get(ENVELOPES, params={"month": month}, headers=headers)
    assert response.status_code == 422 and response.json()["code"] == "validation_error"


def test_the_first_and_last_accepted_months(client, headers, account_id):
    make_envelope(client, headers)
    assert client.get(ENVELOPES, params={"month": "2000-01"}, headers=headers).status_code == 200
    assert client.get(ENVELOPES, params={"month": "2100-12"}, headers=headers).status_code == 200


def test_allocating_in_an_invalid_month_is_422(client, headers):
    envelope_id = make_envelope(client, headers)
    assert allocate(client, headers, envelope_id, "2026-13", "10").status_code == 422


# ---------- Distribuir: quem pode ----------


def test_allocating_to_a_fixed_budget_an_archived_envelope_or_a_missing_one(client, headers, account_id):
    fixed = make_fixed(client, headers)
    refused = allocate(client, headers, fixed, "2026-03", "10.00")
    assert refused.status_code == 400 and refused.json()["code"] == "budget_not_envelope"
    archived = make_envelope(client, headers, name="Velho")
    client.patch(f"{BUDGETS}/{archived}", json={"active": False}, headers=headers)
    assert allocate(client, headers, archived, "2026-03", "10.00").json()["code"] == "budget_not_envelope"
    missing = allocate(client, headers, str(uuid.uuid4()), "2026-03", "10.00")
    assert missing.status_code == 404 and missing.json()["code"] == "budget_not_found"


def test_other_users_envelope_is_404_and_untouched(client, headers, db_session):
    envelope_id = make_envelope(client, headers)
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    response = allocate(client, other, envelope_id, "2026-03", "10.00")
    assert response.status_code == 404 and response.json()["code"] == "budget_not_found"
    assert month_view(client, other)["groups"] == []
    assert db_session.query(BudgetAllocation).count() == 0


@pytest.mark.parametrize("amount", ["abc", "1.234", None, "99999999999999999999.00"])
def test_allocation_amount_validation(client, headers, amount):
    envelope_id = make_envelope(client, headers)
    response = client.put(f"{ENVELOPES}/{envelope_id}/2026-03", json={"amount": amount}, headers=headers)
    assert response.status_code == 422


def test_allocation_body_refuses_extra_fields(client, headers):
    envelope_id = make_envelope(client, headers)
    response = client.put(f"{ENVELOPES}/{envelope_id}/2026-03", json={"amount": "1.00", "month": "2026-04"}, headers=headers)
    assert response.status_code == 422


# ---------- Mover ----------


def move(client, headers, from_id, to_id, amount, month="2026-03"):
    return client.post(
        f"{ENVELOPES}/move", json={"from_budget_id": from_id, "to_budget_id": to_id, "month": month, "amount": amount}, headers=headers
    )


def test_moving_money_changes_both_envelopes_and_keeps_the_total(client, headers, account_id):
    source = make_envelope(client, headers, name="Mercado")
    target = make_envelope(client, headers, name="Lazer")
    allocate(client, headers, source, "2026-03", "300.00")
    response = move(client, headers, source, target, "100.00")
    assert response.status_code == 200
    found = response.json()["groups"][0]
    by_name = {e["name"]: e for e in found["envelopes"]}
    assert (by_name["Mercado"]["allocated"], by_name["Mercado"]["available"]) == ("200.00", "200.00")
    assert (by_name["Lazer"]["allocated"], by_name["Lazer"]["available"]) == ("100.00", "100.00")
    assert (found["in_envelopes"], found["to_budget"]) == ("300.00", "700.00")


def test_moving_everything_leaves_the_source_at_zero_and_removes_its_row(client, headers, account_id, db_session):
    source = make_envelope(client, headers, name="Mercado")
    target = make_envelope(client, headers, name="Lazer")
    allocate(client, headers, source, "2026-03", "300.00")
    move(client, headers, source, target, "300.00")
    assert envelope(client, headers, "Mercado")["available"] == "0.00"
    assert db_session.query(BudgetAllocation).filter_by(budget_id=uuid.UUID(source)).count() == 0


def test_moving_covers_an_overspent_envelope(client, headers, account_id):
    rich = make_envelope(client, headers, name="Reserva")
    broke = make_envelope(client, headers, name="Mercado")
    allocate(client, headers, rich, "2026-03", "300.00")
    allocate(client, headers, broke, "2026-03", "100.00")
    spend(client, headers, account_id, broke, "200.00", on="2026-03-10")
    assert envelope(client, headers, "Mercado")["overspent"] == "100.00"
    move(client, headers, rich, broke, "100.00")
    covered = envelope(client, headers, "Mercado")
    assert (covered["available"], covered["overspent"]) == ("0.00", "0.00")
    assert envelope(client, headers, "Reserva")["available"] == "200.00"


def test_moving_can_take_from_what_carried_from_an_earlier_month(client, headers, account_id):
    source = make_envelope(client, headers, name="Mercado")
    target = make_envelope(client, headers, name="Lazer")
    allocate(client, headers, source, "2026-03", "100.00")
    response = move(client, headers, source, target, "40.00", month="2026-04")
    assert response.status_code == 200
    april = {e["name"]: e for e in response.json()["groups"][0]["envelopes"]}
    # Nada foi distribuido em abril: a origem fica com -40 distribuidos e 60 disponiveis
    assert (april["Mercado"]["carried"], april["Mercado"]["allocated"], april["Mercado"]["available"]) == ("100.00", "-40.00", "60.00")
    assert april["Lazer"]["allocated"] == "40.00"
    assert envelope(client, headers, "Mercado", "2026-03")["available"] == "100.00"


def test_moving_adds_to_what_was_already_allocated(client, headers, account_id):
    source = make_envelope(client, headers, name="Mercado")
    target = make_envelope(client, headers, name="Lazer")
    allocate(client, headers, source, "2026-03", "300.00")
    allocate(client, headers, target, "2026-03", "50.00")
    move(client, headers, source, target, "25.00")
    assert envelope(client, headers, "Lazer")["allocated"] == "75.00"
    assert envelope(client, headers, "Mercado")["allocated"] == "275.00"


def test_moving_more_than_available_is_refused_and_nothing_changes(client, headers, account_id):
    source = make_envelope(client, headers, name="Mercado")
    target = make_envelope(client, headers, name="Lazer")
    allocate(client, headers, source, "2026-03", "100.00")
    spend(client, headers, account_id, source, "30.00", on="2026-03-10")
    refused = move(client, headers, source, target, "80.00")
    assert refused.status_code == 400 and refused.json()["code"] == "envelope_not_enough"
    assert envelope(client, headers, "Mercado")["available"] == "70.00"
    assert envelope(client, headers, "Lazer")["allocated"] == "0.00"
    # Exatamente o que tem, pode
    assert move(client, headers, source, target, "70.00").status_code == 200


def test_an_envelope_with_nothing_cannot_give(client, headers, account_id):
    source = make_envelope(client, headers, name="Mercado")
    target = make_envelope(client, headers, name="Lazer")
    assert move(client, headers, source, target, "0.01").json()["code"] == "envelope_not_enough"


def test_moving_to_the_same_envelope_is_422(client, headers, account_id):
    source = make_envelope(client, headers)
    allocate(client, headers, source, "2026-03", "100.00")
    refused = move(client, headers, source, source, "10.00")
    assert refused.status_code == 422 and refused.json()["code"] == "validation_error"


def test_moving_between_currencies_is_refused(client, headers, account_id):
    reais = make_envelope(client, headers, name="Mercado")
    dollars = make_envelope(client, headers, name="Viagem", currency="USD")
    allocate(client, headers, reais, "2026-03", "100.00")
    refused = move(client, headers, reais, dollars, "10.00")
    assert refused.status_code == 400 and refused.json()["code"] == "currency_mismatch"


def test_moving_with_a_fixed_budget_on_either_side_changes_nothing(client, headers, account_id, db_session):
    source = make_envelope(client, headers, name="Mercado")
    fixed = make_fixed(client, headers)
    allocate(client, headers, source, "2026-03", "100.00")
    for refused in (move(client, headers, source, fixed, "10.00"), move(client, headers, fixed, source, "10.00")):
        assert refused.status_code == 400 and refused.json()["code"] == "budget_not_envelope"
    assert envelope(client, headers, "Mercado")["allocated"] == "100.00"
    assert db_session.query(BudgetAllocation).count() == 1


def test_moving_with_another_users_envelope_is_404(client, headers, db_session):
    mine = make_envelope(client, headers)
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    theirs = make_envelope(client, other, name="Dela")
    for refused in (move(client, headers, mine, theirs, "1.00"), move(client, other, mine, theirs, "1.00")):
        assert refused.status_code == 404


@pytest.mark.parametrize("amount", ["0", "-5.00", "abc", None])
def test_move_amount_must_be_positive(client, headers, account_id, amount):
    source = make_envelope(client, headers, name="Mercado")
    target = make_envelope(client, headers, name="Lazer")
    response = client.post(
        f"{ENVELOPES}/move", json={"from_budget_id": source, "to_budget_id": target, "month": "2026-03", "amount": amount}, headers=headers
    )
    assert response.status_code == 422


def test_move_validates_the_month_and_the_fields(client, headers, account_id):
    source = make_envelope(client, headers, name="Mercado")
    target = make_envelope(client, headers, name="Lazer")
    assert move(client, headers, source, target, "1.00", month="2026-13").status_code == 422
    body = {"from_budget_id": source, "to_budget_id": target, "month": "2026-03", "amount": "1.00", "extra": 1}
    assert client.post(f"{ENVELOPES}/move", json=body, headers=headers).status_code == 422
    assert client.post(f"{ENVELOPES}/move", json={"from_budget_id": source}, headers=headers).status_code == 422


def test_move_respects_the_currency_decimal_places(client, headers):
    make_account(client, headers, name="Iene", currency_code="JPY", opening_balance="1000")
    source = make_envelope(client, headers, name="Ramen", currency="JPY")
    target = make_envelope(client, headers, name="Sushi", currency="JPY")
    allocate(client, headers, source, "2026-03", "300")
    refused = move(client, headers, source, target, "10.5")
    assert refused.status_code == 400 and refused.json()["code"] == "invalid_amount"
    assert move(client, headers, source, target, "10").status_code == 200


# ---------- Banco ----------


def test_the_database_refuses_a_zero_allocation_and_a_month_that_is_not_the_first_day(client, headers, account_id, db_session):
    envelope_id = make_envelope(client, headers)
    user_id = db_session.execute(text("SELECT id FROM users")).scalar_one()
    for month, amount in (("2026-03-01", "0"), ("2026-03-15", "10")):
        with pytest.raises(IntegrityError):
            db_session.execute(
                text("INSERT INTO budget_allocations (id, user_id, budget_id, month, amount) VALUES (:id, :u, :b, :m, :a)"),
                {"id": uuid.uuid4(), "u": user_id, "b": envelope_id, "m": month, "a": Decimal(amount)},
            )
        db_session.rollback()


def test_the_database_allows_only_one_allocation_per_envelope_and_month(client, headers, account_id, db_session):
    envelope_id = make_envelope(client, headers)
    user_id = db_session.execute(text("SELECT id FROM users")).scalar_one()
    insert = text("INSERT INTO budget_allocations (id, user_id, budget_id, month, amount) VALUES (:id, :u, :b, '2026-03-01', 10)")
    db_session.execute(insert, {"id": uuid.uuid4(), "u": user_id, "b": envelope_id})
    with pytest.raises(IntegrityError):
        db_session.execute(insert, {"id": uuid.uuid4(), "u": user_id, "b": envelope_id})
    db_session.rollback()


def test_the_database_ties_the_limit_to_the_mode(client, headers, db_session):
    user_id = register_user_id(client, headers, db_session)
    bad = text(
        "INSERT INTO budgets (id, user_id, name, currency_code, mode, amount, period) "
        "VALUES (:id, :u, :n, 'BRL', :mode, :amount, 'monthly')"
    )
    for mode, amount in (("fixed", None), ("envelope", Decimal("10")), ("fixed", Decimal("-1"))):
        with pytest.raises(IntegrityError):
            db_session.execute(bad, {"id": uuid.uuid4(), "u": user_id, "n": f"x{mode}{amount}", "mode": mode, "amount": amount})
        db_session.rollback()


def register_user_id(client, headers, db_session):
    return db_session.execute(text("SELECT id FROM users")).scalar_one()


def test_deleting_an_envelope_deletes_its_allocations(client, headers, account_id, db_session):
    envelope_id = make_envelope(client, headers)
    allocate(client, headers, envelope_id, "2026-03", "100.00")
    assert db_session.query(BudgetAllocation).count() == 1
    assert client.delete(f"{BUDGETS}/{envelope_id}", headers=headers).status_code == 204
    db_session.expire_all()
    assert db_session.query(BudgetAllocation).count() == 0
