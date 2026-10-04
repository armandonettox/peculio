import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.models.budget import BudgetTemplate
from tests.conftest import auth_headers, make_user, register

API = "/api/v1"
ENVELOPES = f"{API}/envelopes"
BUDGETS = f"{API}/budgets"
ACCOUNTS = f"{API}/accounts"
BILLS = f"{API}/bills"
TX = f"{API}/transactions"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_account(client, headers, **overrides):
    body = {
        "name": "Nubank", "type": "asset", "currency_code": "BRL", "opening_balance": "1000.00",
        "opening_balance_date": "2026-01-01", **overrides,
    }
    response = client.post(ACCOUNTS, json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.fixture
def account_id(client, headers):
    return make_account(client, headers)


def make_envelope(client, headers, name="Mercado", currency="BRL"):
    body = {"name": name, "currency_code": currency, "mode": "envelope"}
    response = client.post(BUDGETS, json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def make_bill(client, headers, name="Aluguel", low="1800.00", high="1900.00", first="2026-01-08", frequency="monthly", currency="BRL"):
    body = {
        "name": name, "currency_code": currency, "amount_min": low, "amount_max": high,
        "first_due_date": first, "frequency": frequency,
    }
    response = client.post(BILLS, json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def set_template(client, headers, budget_id, **body):
    return client.put(f"{ENVELOPES}/{budget_id}/template", json=body, headers=headers)


def allocate(client, headers, budget_id, month, amount):
    return client.put(f"{ENVELOPES}/{budget_id}/{month}", json={"amount": amount}, headers=headers)


def preview(client, headers, month="2026-03", overwrite=False):
    response = client.get(f"{ENVELOPES}/templates/preview", params={"month": month, "overwrite": overwrite}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def apply(client, headers, month="2026-03", overwrite=False):
    return client.post(f"{ENVELOPES}/templates/apply", json={"month": month, "overwrite": overwrite}, headers=headers)


def rows(body):
    return {row["name"]: row for group in body["groups"] for row in group["rows"]}


def envelope(client, headers, name, month="2026-03"):
    body = client.get(ENVELOPES, params={"month": month}, headers=headers).json()
    return next(e for g in body["groups"] for e in g["envelopes"] if e["name"] == name)


def spend(client, headers, account_id, budget_id, amount, on="2026-03-10"):
    split = {
        "type": "withdrawal", "date": on, "description": "Compra", "amount": amount, "currency_code": "BRL",
        "account_id": account_id, "counterparty_name": "Loja", "budget_id": budget_id,
    }
    assert client.post(TX, json={"splits": [split]}, headers=headers).status_code == 201


# ---------- Definir ----------


def test_requires_login(client):
    assert client.put(f"{ENVELOPES}/{uuid.uuid4()}/template", json={}).status_code == 401
    assert client.delete(f"{ENVELOPES}/{uuid.uuid4()}/template").status_code == 401
    assert client.get(f"{ENVELOPES}/templates/preview").status_code == 401
    assert client.post(f"{ENVELOPES}/templates/apply", json={}).status_code == 401


def test_each_kind_is_saved_with_only_its_own_fields(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    bill_id = make_bill(client, headers)
    fixed = set_template(client, headers, envelope_id, kind="fixed", amount="300.00")
    assert fixed.status_code == 200
    assert fixed.json() == {"kind": "fixed", "amount": "300.00", "target_month": None, "bill_id": None}
    by_date = set_template(client, headers, envelope_id, kind="by_date", amount="6000.00", target_month="2026-06")
    assert by_date.json() == {"kind": "by_date", "amount": "6000.00", "target_month": "2026-06-01", "bill_id": None}
    bill = set_template(client, headers, envelope_id, kind="bill", bill_id=bill_id)
    assert bill.json() == {"kind": "bill", "amount": None, "target_month": None, "bill_id": bill_id}
    rest = set_template(client, headers, envelope_id, kind="remainder")
    assert rest.json() == {"kind": "remainder", "amount": None, "target_month": None, "bill_id": None}


def test_setting_again_replaces_the_template_and_there_is_only_one(client, headers, db_session):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="fixed", amount="100.00")
    set_template(client, headers, envelope_id, kind="remainder")
    assert db_session.query(BudgetTemplate).count() == 1


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "fixed"},
        {"kind": "fixed", "amount": "0"},
        {"kind": "fixed", "amount": "-5"},
        {"kind": "fixed", "amount": "10", "target_month": "2026-06"},
        {"kind": "fixed", "amount": "10", "bill_id": str(uuid.uuid4())},
        {"kind": "by_date", "amount": "10"},
        {"kind": "by_date", "target_month": "2026-06"},
        {"kind": "by_date", "amount": "10", "target_month": "2026-13"},
        {"kind": "by_date", "amount": "10", "target_month": "2026-06-01"},
        {"kind": "bill"},
        {"kind": "bill", "bill_id": str(uuid.uuid4()), "amount": "10"},
        {"kind": "remainder", "amount": "10"},
        {"kind": "remainder", "target_month": "2026-06"},
        {"kind": "remainder", "bill_id": str(uuid.uuid4())},
        {"kind": "outro"},
        {"amount": "10"},
        {"kind": "fixed", "amount": "10", "extra": 1},
    ],
)
def test_template_validation_returns_422(client, headers, body):
    envelope_id = make_envelope(client, headers)
    response = set_template(client, headers, envelope_id, **body)
    assert response.status_code == 422 and response.json()["code"] == "validation_error"


def test_only_envelopes_can_have_templates(client, headers):
    fixed = client.post(BUDGETS, json={"name": "Lazer", "currency_code": "BRL", "amount": "400.00", "period": "monthly"}, headers=headers).json()["id"]
    refused = set_template(client, headers, fixed, kind="fixed", amount="10.00")
    assert refused.status_code == 400 and refused.json()["code"] == "budget_not_envelope"
    archived = make_envelope(client, headers, name="Velho")
    client.patch(f"{BUDGETS}/{archived}", json={"active": False}, headers=headers)
    assert set_template(client, headers, archived, kind="remainder").json()["code"] == "budget_not_envelope"
    assert set_template(client, headers, str(uuid.uuid4()), kind="remainder").status_code == 404


def test_the_amount_respects_the_currency_decimal_places(client, headers):
    make_account(client, headers, name="Iene", currency_code="JPY", opening_balance="1000")
    yen = make_envelope(client, headers, name="Ramen", currency="JPY")
    refused = set_template(client, headers, yen, kind="fixed", amount="10.5")
    assert refused.status_code == 400 and refused.json()["code"] == "invalid_amount"
    assert set_template(client, headers, yen, kind="fixed", amount="10").status_code == 200


def test_the_bill_must_be_mine_and_in_the_same_currency(client, headers, db_session):
    envelope_id = make_envelope(client, headers)
    dollars = make_bill(client, headers, name="Assinatura", low="9.00", high="10.00", currency="USD")
    refused = set_template(client, headers, envelope_id, kind="bill", bill_id=dollars)
    assert refused.status_code == 400 and refused.json()["code"] == "currency_mismatch"
    missing = set_template(client, headers, envelope_id, kind="bill", bill_id=str(uuid.uuid4()))
    assert missing.status_code == 404 and missing.json()["code"] == "bill_not_found"
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    theirs = make_bill(client, other, name="Dela")
    assert set_template(client, headers, envelope_id, kind="bill", bill_id=theirs).status_code == 404


def test_other_users_envelope_is_404(client, headers, db_session):
    envelope_id = make_envelope(client, headers)
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    assert set_template(client, other, envelope_id, kind="remainder").status_code == 404
    assert client.delete(f"{ENVELOPES}/{envelope_id}/template", headers=other).status_code == 404


def test_removing_a_template_and_removing_one_that_does_not_exist(client, headers, db_session):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="remainder")
    assert client.delete(f"{ENVELOPES}/{envelope_id}/template", headers=headers).status_code == 204
    assert db_session.query(BudgetTemplate).count() == 0
    gone = client.delete(f"{ENVELOPES}/{envelope_id}/template", headers=headers)
    assert gone.status_code == 404 and gone.json()["code"] == "template_not_found"


def test_deleting_the_envelope_or_the_bill_removes_the_template(client, headers, db_session):
    first = make_envelope(client, headers, name="A")
    second = make_envelope(client, headers, name="B")
    bill_id = make_bill(client, headers)
    set_template(client, headers, first, kind="fixed", amount="10.00")
    set_template(client, headers, second, kind="bill", bill_id=bill_id)
    assert db_session.query(BudgetTemplate).count() == 2
    client.delete(f"{BUDGETS}/{first}", headers=headers)
    client.delete(f"{BILLS}/{bill_id}", headers=headers)
    db_session.expire_all()
    assert db_session.query(BudgetTemplate).count() == 0


# ---------- O mes mostra o template e o selo de meta ----------


def test_the_month_view_carries_the_template_and_the_goal(client, headers, account_id):
    fixed = make_envelope(client, headers, name="Fixo")
    plain = make_envelope(client, headers, name="Sem")
    set_template(client, headers, fixed, kind="fixed", amount="300.00")
    assert envelope(client, headers, "Sem")["template"] is None and envelope(client, headers, "Sem")["goal"] is None
    body = envelope(client, headers, "Fixo")
    assert body["template"] == {"kind": "fixed", "amount": "300.00", "target_month": None, "bill_id": None}
    assert body["goal"] == "short"
    allocate(client, headers, fixed, "2026-03", "150.00")
    assert envelope(client, headers, "Fixo")["goal"] == "partial"
    allocate(client, headers, fixed, "2026-03", "300.00")
    assert envelope(client, headers, "Fixo")["goal"] == "met"
    assert plain


def test_the_goal_of_a_remainder_template_is_never_shown(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="remainder")
    assert envelope(client, headers, "Mercado")["goal"] is None


def test_a_by_date_goal_is_met_once_the_envelope_already_has_the_target(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="by_date", amount="500.00", target_month="2026-06")
    assert envelope(client, headers, "Mercado")["goal"] == "short"
    allocate(client, headers, envelope_id, "2026-02", "500.00")
    assert envelope(client, headers, "Mercado")["goal"] == "met"


def test_the_template_follows_the_envelope_through_other_calls(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="fixed", amount="100.00")
    response = allocate(client, headers, envelope_id, "2026-03", "40.00")
    assert response.json()["groups"][0]["envelopes"][0]["template"]["amount"] == "100.00"


# ---------- Previa ----------


def test_preview_without_templates_is_empty_per_group(client, headers, account_id):
    make_envelope(client, headers)
    body = preview(client, headers)
    assert body["month"] == "2026-03-01" and body["overwrite"] is False
    assert body["groups"][0]["rows"] == []
    assert body["groups"][0]["to_budget_before"] == body["groups"][0]["to_budget_after"] == "1000.00"


def test_preview_of_a_fixed_template_fills_an_empty_envelope(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="fixed", amount="300.00")
    group = preview(client, headers)["groups"][0]
    assert rows({"groups": [group]})["Mercado"] == {
        "budget_id": envelope_id, "name": "Mercado", "kind": "fixed", "current": "0.00", "wanted": "300.00",
        "proposed": "300.00", "applies": True, "reason": None,
    }
    assert (group["to_budget_before"], group["to_budget_after"]) == ("1000.00", "700.00")


def test_preview_writes_nothing(client, headers, account_id, db_session):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="fixed", amount="300.00")
    preview(client, headers)
    assert envelope(client, headers, "Mercado")["allocated"] == "0.00"


def test_an_envelope_that_already_has_a_value_is_left_alone_unless_overwrite(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="fixed", amount="300.00")
    allocate(client, headers, envelope_id, "2026-03", "120.00")
    kept = rows(preview(client, headers))["Mercado"]
    assert (kept["applies"], kept["reason"], kept["proposed"], kept["current"]) == (False, "already_has", "120.00", "120.00")
    forced = rows(preview(client, headers, overwrite=True))["Mercado"]
    assert (forced["applies"], forced["proposed"], forced["reason"]) == (True, "300.00", None)


def test_preview_by_date_divides_what_is_missing_by_the_months_left(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="by_date", amount="6000.00", target_month="2026-06")
    assert rows(preview(client, headers))["Mercado"]["proposed"] == "1500.00"
    # O que passou do mes anterior ja conta para a meta
    allocate(client, headers, envelope_id, "2026-02", "1200.00")
    assert rows(preview(client, headers))["Mercado"]["proposed"] == "1200.00"


def test_preview_by_date_explains_a_goal_already_met_and_a_date_that_passed(client, headers, account_id):
    met = make_envelope(client, headers, name="Pronta")
    passed = make_envelope(client, headers, name="Vencida")
    set_template(client, headers, met, kind="by_date", amount="500.00", target_month="2026-06")
    set_template(client, headers, passed, kind="by_date", amount="500.00", target_month="2026-02")
    allocate(client, headers, met, "2026-02", "500.00")
    found = rows(preview(client, headers))
    assert (found["Pronta"]["applies"], found["Pronta"]["reason"]) == (False, "goal_met")
    assert (found["Vencida"]["applies"], found["Vencida"]["reason"]) == (False, "date_passed")


def test_a_by_date_goal_whose_date_passed_but_was_reached_counts_as_met(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="by_date", amount="500.00", target_month="2026-02")
    allocate(client, headers, envelope_id, "2026-02", "500.00")
    assert rows(preview(client, headers))["Mercado"]["reason"] == "goal_met"


def test_preview_bill_uses_the_top_of_the_range_in_the_months_it_is_due(client, headers, account_id):
    rent = make_envelope(client, headers, name="Aluguel")
    quarterly = make_envelope(client, headers, name="Seguro")
    set_template(client, headers, rent, kind="bill", bill_id=make_bill(client, headers))
    set_template(
        client, headers, quarterly, kind="bill",
        bill_id=make_bill(client, headers, name="Seguro do carro", low="290.00", high="320.00", first="2026-01-20", frequency="quarterly"),
    )
    march = rows(preview(client, headers, "2026-03"))
    assert (march["Aluguel"]["proposed"], march["Aluguel"]["applies"]) == ("1900.00", True)
    assert (march["Seguro"]["applies"], march["Seguro"]["reason"], march["Seguro"]["wanted"]) == (False, "no_due_date", "0.00")
    assert rows(preview(client, headers, "2026-04"))["Seguro"]["proposed"] == "320.00"


def test_preview_remainder_splits_what_is_left_after_the_other_templates(client, headers, account_id):
    fixed = make_envelope(client, headers, name="Fixo")
    one = make_envelope(client, headers, name="Sobra A")
    two = make_envelope(client, headers, name="Sobra B")
    set_template(client, headers, fixed, kind="fixed", amount="400.00")
    set_template(client, headers, one, kind="remainder")
    set_template(client, headers, two, kind="remainder")
    group = preview(client, headers)["groups"][0]
    found = rows({"groups": [group]})
    assert (found["Fixo"]["proposed"], found["Sobra A"]["proposed"], found["Sobra B"]["proposed"]) == ("400.00", "300.00", "300.00")
    assert group["to_budget_after"] == "0.00"


def test_remainder_rounds_down_and_never_hands_out_more_than_is_left(client, headers, account_id):
    ids = [make_envelope(client, headers, name=f"R{n}") for n in range(3)]
    for envelope_id in ids:
        set_template(client, headers, envelope_id, kind="remainder")
    group = preview(client, headers)["groups"][0]
    assert [row["proposed"] for row in group["rows"]] == ["333.33", "333.33", "333.33"]
    assert Decimal(group["to_budget_after"]) == Decimal("0.01")


def test_remainder_gets_nothing_when_the_other_templates_took_everything(client, headers, account_id):
    fixed = make_envelope(client, headers, name="Fixo")
    rest = make_envelope(client, headers, name="Resto")
    set_template(client, headers, fixed, kind="fixed", amount="1000.00")
    set_template(client, headers, rest, kind="remainder")
    found = rows(preview(client, headers))
    assert (found["Resto"]["applies"], found["Resto"]["reason"], found["Resto"]["proposed"]) == (False, "no_money_left", "0.00")


def test_templates_may_add_up_to_more_than_there_is_and_the_preview_shows_a_negative_to_budget(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="fixed", amount="1500.00")
    group = preview(client, headers)["groups"][0]
    assert group["to_budget_after"] == "-500.00"
    assert rows({"groups": [group]})["Mercado"]["applies"] is True


def test_remainder_with_a_negative_to_budget_gets_nothing(client, headers, account_id):
    fixed = make_envelope(client, headers, name="Fixo")
    rest = make_envelope(client, headers, name="Resto")
    set_template(client, headers, fixed, kind="fixed", amount="1500.00")
    set_template(client, headers, rest, kind="remainder")
    assert rows(preview(client, headers))["Resto"]["reason"] == "no_money_left"


def test_remainder_overwrite_recalculates_from_zero_and_counts_its_own_current_value(client, headers, account_id):
    rest = make_envelope(client, headers, name="Resto")
    set_template(client, headers, rest, kind="remainder")
    allocate(client, headers, rest, "2026-03", "200.00")
    assert rows(preview(client, headers))["Resto"]["reason"] == "already_has"
    forced = rows(preview(client, headers, overwrite=True))["Resto"]
    # Tirando os 200 que ja estavam la, sobra o dinheiro todo: o envelope fica com ele
    assert (forced["applies"], forced["proposed"]) == (True, "1000.00")


def test_a_template_that_needs_nothing_leaves_the_to_budget_alone(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="by_date", amount="500.00", target_month="2026-02")
    group = preview(client, headers)["groups"][0]
    assert group["to_budget_before"] == group["to_budget_after"]


def test_each_currency_is_previewed_on_its_own(client, headers, account_id):
    make_account(client, headers, name="Dolar", currency_code="USD", opening_balance="200.00")
    reais = make_envelope(client, headers, name="Mercado")
    dollars = make_envelope(client, headers, name="Viagem", currency="USD")
    set_template(client, headers, reais, kind="remainder")
    set_template(client, headers, dollars, kind="remainder")
    groups = {g["currency_code"]: g for g in preview(client, headers)["groups"]}
    assert groups["BRL"]["rows"][0]["proposed"] == "1000.00" and groups["USD"]["rows"][0]["proposed"] == "200.00"


def test_preview_validates_the_month(client, headers, account_id):
    make_envelope(client, headers)
    for month in ("2026-13", "abc", "2026-3"):
        assert client.get(f"{ENVELOPES}/templates/preview", params={"month": month}, headers=headers).status_code == 422


def test_preview_of_the_default_month_works(client, headers, account_id):
    make_envelope(client, headers)
    assert client.get(f"{ENVELOPES}/templates/preview", headers=headers).status_code == 200


# ---------- Aplicar ----------


def test_apply_writes_what_the_preview_showed(client, headers, account_id):
    fixed = make_envelope(client, headers, name="Fixo")
    rest = make_envelope(client, headers, name="Resto")
    set_template(client, headers, fixed, kind="fixed", amount="400.00")
    set_template(client, headers, rest, kind="remainder")
    shown = rows(preview(client, headers))
    response = apply(client, headers)
    assert response.status_code == 200
    body = response.json()["groups"][0]
    by_name = {e["name"]: e for e in body["envelopes"]}
    assert by_name["Fixo"]["allocated"] == shown["Fixo"]["proposed"] == "400.00"
    assert by_name["Resto"]["allocated"] == shown["Resto"]["proposed"] == "600.00"
    assert body["to_budget"] == "0.00"
    assert by_name["Fixo"]["goal"] == "met"


def test_apply_without_overwrite_keeps_what_the_person_already_distributed(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="fixed", amount="300.00")
    allocate(client, headers, envelope_id, "2026-03", "120.00")
    apply(client, headers)
    assert envelope(client, headers, "Mercado")["allocated"] == "120.00"
    apply(client, headers, overwrite=True)
    assert envelope(client, headers, "Mercado")["allocated"] == "300.00"


def test_applying_twice_changes_nothing_the_second_time(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="fixed", amount="300.00")
    apply(client, headers)
    again = rows(preview(client, headers))["Mercado"]
    assert (again["applies"], again["reason"]) == (False, "already_has")
    apply(client, headers)
    assert envelope(client, headers, "Mercado")["allocated"] == "300.00"


def test_apply_only_touches_the_month_asked(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="fixed", amount="300.00")
    apply(client, headers, month="2026-04")
    assert envelope(client, headers, "Mercado", "2026-03")["allocated"] == "0.00"
    assert envelope(client, headers, "Mercado", "2026-04")["allocated"] == "300.00"


def test_apply_with_nothing_to_do_is_fine(client, headers, account_id):
    make_envelope(client, headers)
    assert apply(client, headers).status_code == 200


def test_apply_overspending_still_follows_the_envelope_rules(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="fixed", amount="100.00")
    spend(client, headers, account_id, envelope_id, "130.00")
    apply(client, headers)
    item = envelope(client, headers, "Mercado")
    assert (item["allocated"], item["available"], item["overspent"]) == ("100.00", "-30.00", "30.00")


def test_apply_can_leave_the_to_budget_negative(client, headers, account_id):
    envelope_id = make_envelope(client, headers)
    set_template(client, headers, envelope_id, kind="fixed", amount="1500.00")
    assert apply(client, headers).json()["groups"][0]["to_budget"] == "-500.00"


def test_apply_validates_the_body(client, headers, account_id):
    make_envelope(client, headers)
    for body in ({}, {"month": "2026-13"}, {"month": "2026-03", "overwrite": "talvez"}, {"month": "2026-03", "extra": 1}):
        assert client.post(f"{ENVELOPES}/templates/apply", json=body, headers=headers).status_code == 422


def test_apply_never_touches_other_users_envelopes(client, headers, db_session):
    make_account(client, headers)
    mine = make_envelope(client, headers)
    set_template(client, headers, mine, kind="fixed", amount="100.00")
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    make_account(client, other)
    theirs = make_envelope(client, other, name="Dela")
    set_template(client, other, theirs, kind="fixed", amount="50.00")
    apply(client, headers)
    assert envelope(client, headers, "Mercado")["allocated"] == "100.00"
    assert envelope(client, other, "Dela")["allocated"] == "0.00"


# ---------- Banco ----------


def test_the_database_ties_each_field_to_the_kind(client, headers, db_session):
    envelope_id = make_envelope(client, headers)
    user_id = db_session.execute(text("SELECT id FROM users")).scalar_one()
    insert = text(
        "INSERT INTO budget_templates (id, user_id, budget_id, kind, amount, target_month, bill_id) "
        "VALUES (:id, :u, :b, :kind, :amount, :month, NULL)"
    )
    bad = [
        ("fixed", None, None), ("fixed", Decimal("10"), "2026-06-01"), ("by_date", Decimal("10"), None),
        ("by_date", Decimal("10"), "2026-06-15"), ("remainder", Decimal("10"), None), ("fixed", Decimal("0"), None),
        ("bill", None, None),
    ]
    for kind, amount, month in bad:
        with pytest.raises(IntegrityError):
            db_session.execute(insert, {"id": uuid.uuid4(), "u": user_id, "b": envelope_id, "kind": kind, "amount": amount, "month": month})
        db_session.rollback()
