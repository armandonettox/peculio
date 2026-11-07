"""Planejamento mensal: renda, economia e limite por categoria, com o gasto do mes pago e previsto."""

from decimal import Decimal

import pytest
from alembic import command
from sqlalchemy import text

from app.core.database import engine
from tests.conftest import alembic_config, auth_headers, make_user, register

URL = "/api/v1/plans/monthly"
TX = "/api/v1/transactions"
MONTH = "2026-11"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def account(client, headers, name="Itau", **extra):
    body = {"name": name, "type": "asset", "currency_code": "BRL", "opening_balance": "10000.00", **extra}
    resp = client.post("/api/v1/accounts", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def card(client, headers, name="Cartao", closing_day=28, due_day=5):
    return account(client, headers, name=name, role="credit_card", closing_day=closing_day, due_day=due_day, opening_balance="0")


def category(client, headers, name="Casa", kind="expense"):
    resp = client.post("/api/v1/categories", json={"name": name, "kind": kind, "color": "#00A878", "icon": "house"}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def spend(client, headers, account_id, amount="100.00", on="2026-11-10", category_id=None, kind="withdrawal", **extra):
    split = {
        "type": kind,
        "date": on,
        "description": "Movimento",
        "amount": amount,
        "currency_code": extra.pop("currency_code", "BRL"),
        "account_id": account_id,
        "counterparty_name": "Local",
        **({"category_id": category_id} if category_id else {}),
        **extra,
    }
    resp = client.post(TX, json={"splits": [split]}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def create(client, headers, month=MONTH, income="5000.00", savings_percent="20", items=None, **extra):
    body = {"income": income, "savings_percent": savings_percent, "items": items or [], **extra}
    return client.post(f"{URL}/{month}", json=body, headers=headers)


def get(client, headers, month=MONTH):
    resp = client.get(f"{URL}/{month}", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def row(plan, name):
    return next(item for item in plan["rows"] if item["category_name"] == name)


def rest(plan):
    return next(item for item in plan["rows"] if item["kind"] == "rest")


def other_headers(client, db_session):
    make_user(db_session, email="outra@example.com")
    return auth_headers(client, email="outra@example.com")


def test_requires_login(client):
    assert client.get(f"{URL}/{MONTH}").status_code == 401
    assert client.post(f"{URL}/{MONTH}", json={}).status_code == 401
    assert client.delete(URL).status_code == 401


# ---------- Criar ----------


def test_create_computes_the_spending_budget_from_income_and_savings(client, headers):
    resp = create(client, headers)
    assert resp.status_code == 201, resp.text
    plan = resp.json()
    assert plan["month"] == "2026-11-01"
    assert (plan["income"], plan["savings_percent"], plan["spending_budget"], plan["savings_amount"]) == (
        "5000.00",
        "20.00",
        "4000.00",
        "1000.00",
    )
    assert plan["currency_code"] == "BRL"
    assert plan["card_counting"] == "purchase"
    # Sem limites por categoria, tudo cai em "Categorias restantes"
    assert [item["kind"] for item in plan["rows"]] == ["rest"]
    assert rest(plan)["planned"] == "4000.00"


def test_create_with_limits_lists_them_by_name_and_the_rest_row_is_what_is_left(client, headers):
    casa, lazer = category(client, headers, "Casa"), category(client, headers, "Lazer")
    plan = create(client, headers, items=[{"category_id": lazer, "amount": "300.00"}, {"category_id": casa, "amount": "1500.00", "alert": True}]).json()
    assert [item["category_name"] for item in plan["rows"]] == ["Casa", "Lazer", None]
    assert row(plan, "Casa")["planned"] == "1500.00" and row(plan, "Casa")["alert"] is True
    assert row(plan, "Lazer")["alert"] is False
    assert row(plan, "Casa")["category_icon"] == "house" and row(plan, "Casa")["category_color"] == "#00A878"
    assert rest(plan)["planned"] == "2200.00"


def test_one_plan_per_month(client, headers):
    assert create(client, headers).status_code == 201
    resp = create(client, headers)
    assert resp.status_code == 409
    assert resp.json()["code"] == "monthly_plan_exists"
    assert create(client, headers, month="2026-12").status_code == 201


@pytest.mark.parametrize("month", ["2026-13", "2026-00", "2026-1", "202611", "novembro", "2026-11-01"])
def test_the_month_must_be_year_dash_month(client, headers, month):
    resp = client.post(f"{URL}/{month}", json={"income": "10.00"}, headers=headers)
    assert resp.status_code in (404, 422)
    assert client.get(f"{URL}/{month}", headers=headers).status_code in (404, 422)


@pytest.mark.parametrize(
    "overrides",
    [{"income": "-1"}, {"savings_percent": "101"}, {"savings_percent": "-5"}, {"income": "abc"}, {"card_counting": "outro"}],
)
def test_invalid_header_values_are_rejected(client, headers, overrides):
    resp = create(client, headers, **{"income": "5000.00", **overrides})
    assert resp.status_code == 422
    assert resp.json()["code"] == "validation_error"


def test_zero_savings_and_zero_income_are_valid(client, headers):
    plan = create(client, headers, income="1000.00", savings_percent="0").json()
    assert plan["spending_budget"] == "1000.00"
    assert create(client, headers, month="2026-12", income="0").json()["spending_budget"] == "0.00"


def test_savings_percent_can_have_two_decimals(client, headers):
    plan = create(client, headers, income="1000.00", savings_percent="12.5").json()
    assert (plan["savings_percent"], plan["spending_budget"], plan["savings_amount"]) == ("12.50", "875.00", "125.00")


# ---------- Validacao dos limites ----------


def test_only_expense_categories_can_have_a_limit(client, headers):
    income = category(client, headers, "Salario", kind="revenue")
    resp = create(client, headers, items=[{"category_id": income, "amount": "100.00"}])
    assert resp.status_code == 400
    assert resp.json()["code"] == "category_kind_mismatch"


def test_a_category_of_another_user_is_404(client, headers, db_session):
    other = other_headers(client, db_session)
    foreign = category(client, other, "Dela")
    assert create(client, headers, items=[{"category_id": foreign, "amount": "100.00"}]).status_code == 404


def test_repeated_categories_and_non_positive_limits_are_rejected(client, headers):
    casa = category(client, headers)
    twice = [{"category_id": casa, "amount": "10.00"}, {"category_id": casa, "amount": "20.00"}]
    assert create(client, headers, items=twice).status_code == 422
    for amount in ("0", "-5.00"):
        assert create(client, headers, items=[{"category_id": casa, "amount": amount}]).status_code == 422


def test_the_sum_of_limits_cannot_pass_the_spending_budget(client, headers):
    casa, lazer = category(client, headers, "Casa"), category(client, headers, "Lazer")
    items = [{"category_id": casa, "amount": "3000.00"}, {"category_id": lazer, "amount": "1000.01"}]
    resp = create(client, headers, items=items)
    assert resp.status_code == 400
    assert resp.json()["code"] == "plan_items_exceed_budget"
    # Fechar a conta exata (4000,00) e permitido, e nada ficou gravado da tentativa recusada
    assert client.get(f"{URL}/{MONTH}", headers=headers).status_code == 404
    items[1]["amount"] = "1000.00"
    plan = create(client, headers, items=items).json()
    assert rest(plan)["planned"] == "0.00"


# ---------- Ler: o gasto ----------


def test_spending_is_split_into_paid_and_expected(client, headers):
    bank, casa = account(client, headers), category(client, headers)
    create(client, headers, items=[{"category_id": casa, "amount": "1000.00"}])
    spend(client, headers, bank, "300.00", category_id=casa)
    spend(client, headers, bank, "150.00", category_id=casa, is_paid=False)
    line = row(get(client, headers), "Casa")
    assert (line["paid"], line["expected"], line["total"], line["remaining"]) == ("300.00", "150.00", "450.00", "550.00")


def test_ignored_other_months_other_currencies_deposits_and_transfers_do_not_count(client, headers):
    bank, other_bank, casa = account(client, headers), account(client, headers, name="Poupanca"), category(client, headers)
    usd = account(client, headers, name="Dolar", currency_code="USD")
    create(client, headers, items=[{"category_id": casa, "amount": "1000.00"}])
    spend(client, headers, bank, "100.00", category_id=casa)
    spend(client, headers, bank, "999.00", category_id=casa, ignored=True)
    spend(client, headers, bank, "999.00", category_id=casa, on="2026-10-31")
    spend(client, headers, bank, "999.00", category_id=casa, on="2026-12-01")
    spend(client, headers, usd, "999.00", category_id=casa, currency_code="USD")
    spend(client, headers, bank, "999.00", kind="deposit")
    transfer = {
        "type": "transfer",
        "date": "2026-11-10",
        "description": "Passei",
        "amount": "999.00",
        "currency_code": "BRL",
        "account_id": bank,
        "counterparty_account_id": other_bank,
    }
    assert client.post(TX, json={"splits": [transfer]}, headers=headers).status_code == 201
    plan = get(client, headers)
    assert row(plan, "Casa")["total"] == "100.00"
    assert plan["summary"]["spent_total"] == "100.00"


def test_the_whole_month_counts_including_the_first_and_last_day(client, headers):
    bank, casa = account(client, headers), category(client, headers)
    create(client, headers, items=[{"category_id": casa, "amount": "1000.00"}])
    spend(client, headers, bank, "10.00", category_id=casa, on="2026-11-01")
    spend(client, headers, bank, "20.00", category_id=casa, on="2026-11-30")
    assert row(get(client, headers), "Casa")["total"] == "30.00"


def test_uncategorized_and_unlimited_categories_fall_into_the_rest_row(client, headers):
    bank, casa, lazer = account(client, headers), category(client, headers, "Casa"), category(client, headers, "Lazer")
    create(client, headers, items=[{"category_id": casa, "amount": "1000.00"}])
    spend(client, headers, bank, "100.00", category_id=casa)
    spend(client, headers, bank, "40.00", category_id=lazer)
    spend(client, headers, bank, "25.00")
    spend(client, headers, bank, "5.00", is_paid=False)
    plan = get(client, headers)
    assert (rest(plan)["paid"], rest(plan)["expected"], rest(plan)["total"]) == ("65.00", "5.00", "70.00")
    assert rest(plan)["planned"] == "3000.00" and rest(plan)["remaining"] == "2930.00"
    summary = plan["summary"]
    assert (summary["spent_paid"], summary["spent_expected"], summary["spent_total"], summary["remaining"]) == (
        "165.00",
        "5.00",
        "170.00",
        "3830.00",
    )


def test_row_state_is_ok_near_or_exceeded(client, headers):
    bank, casa, lazer, mercado = (account(client, headers), category(client, headers, "Casa"), category(client, headers, "Lazer"), category(client, headers, "Mercado"))
    items = [{"category_id": c, "amount": "1000.00"} for c in (casa, lazer, mercado)]
    create(client, headers, items=items)
    spend(client, headers, bank, "799.99", category_id=casa)
    spend(client, headers, bank, "800.00", category_id=lazer)
    spend(client, headers, bank, "1000.01", category_id=mercado)
    plan = get(client, headers)
    assert (row(plan, "Casa")["state"], row(plan, "Lazer")["state"], row(plan, "Mercado")["state"]) == ("ok", "near", "exceeded")
    assert row(plan, "Mercado")["remaining"] == "-0.01"


def test_an_expected_expense_also_moves_the_state(client, headers):
    bank, casa = account(client, headers), category(client, headers)
    create(client, headers, items=[{"category_id": casa, "amount": "100.00"}])
    spend(client, headers, bank, "90.00", category_id=casa, is_paid=False)
    assert row(get(client, headers), "Casa")["state"] == "near"


def test_deleting_a_category_removes_its_limit_and_its_spending_goes_to_the_rest(client, headers):
    bank, casa = account(client, headers), category(client, headers)
    create(client, headers, items=[{"category_id": casa, "amount": "1000.00"}])
    spend(client, headers, bank, "100.00", category_id=casa)
    assert client.delete(f"/api/v1/categories/{casa}", headers=headers).status_code == 204
    plan = get(client, headers)
    assert [item["kind"] for item in plan["rows"]] == ["rest"]
    assert (rest(plan)["planned"], rest(plan)["total"]) == ("4000.00", "100.00")


# ---------- Cartao: pela data da compra ou pela fatura ----------


def test_card_purchase_counts_on_the_purchase_date_by_default(client, headers):
    visa = card(client, headers)
    # Fecha dia 28 e vence dia 5: a compra de 7/11 esta na fatura que vence em 5/12
    spend(client, headers, visa, "200.00", on="2026-11-07")
    create(client, headers)
    assert get(client, headers)["summary"]["spent_total"] == "200.00"
    create(client, headers, month="2026-12")
    assert get(client, headers, "2026-12")["summary"]["spent_total"] == "0.00"


def test_in_invoice_mode_a_card_purchase_counts_in_the_month_the_invoice_is_due(client, headers):
    visa, bank = card(client, headers), account(client, headers)
    spend(client, headers, visa, "200.00", on="2026-11-07")
    spend(client, headers, bank, "50.00", on="2026-11-07")
    create(client, headers, card_counting="invoice")
    create(client, headers, month="2026-12", card_counting="invoice")
    november, december = get(client, headers), get(client, headers, "2026-12")
    # A conta bancaria nao muda; o cartao vai para dezembro (vencimento 5/12)
    assert november["summary"]["spent_total"] == "50.00"
    assert december["summary"]["spent_total"] == "200.00"


def test_in_invoice_mode_the_chosen_invoice_decides_the_month(client, headers):
    visa = card(client, headers)
    # Comprou em 7/11 e escolheu a fatura que fecha em 28/01 (vence em 5/02)
    spend(client, headers, visa, "300.00", on="2026-11-07", invoice_date="2027-01-28")
    create(client, headers, month="2026-12", card_counting="invoice")
    create(client, headers, month="2027-02", card_counting="invoice")
    assert get(client, headers, "2026-12")["summary"]["spent_total"] == "0.00"
    assert get(client, headers, "2027-02")["summary"]["spent_total"] == "300.00"


def test_in_purchase_mode_the_chosen_invoice_does_not_move_the_purchase(client, headers):
    visa = card(client, headers)
    spend(client, headers, visa, "300.00", on="2026-11-07", invoice_date="2027-01-28")
    create(client, headers)
    assert get(client, headers)["summary"]["spent_total"] == "300.00"


def test_invoice_mode_counts_a_purchase_made_before_the_month_but_due_in_it(client, headers):
    visa = card(client, headers)
    # Compra de 30/10 cai na fatura que fecha 28/11 e vence 5/12; compra de 20/10 cai na que fecha 28/10 e vence 5/11
    spend(client, headers, visa, "70.00", on="2026-10-20")
    spend(client, headers, visa, "30.00", on="2026-10-30")
    create(client, headers, card_counting="invoice")
    assert get(client, headers)["summary"]["spent_total"] == "70.00"


def test_card_counting_can_be_changed_and_the_numbers_follow(client, headers):
    visa = card(client, headers)
    spend(client, headers, visa, "200.00", on="2026-11-07")
    create(client, headers)
    assert get(client, headers)["summary"]["spent_total"] == "200.00"
    resp = client.patch(f"{URL}/{MONTH}", json={"card_counting": "invoice"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["summary"]["spent_total"] == "0.00"


# ---------- Resumo ----------


def test_summary_uses_the_real_income_of_the_month(client, headers):
    bank = account(client, headers)
    create(client, headers)
    spend(client, headers, bank, "400.00", kind="deposit")
    spend(client, headers, bank, "999.00", kind="deposit", ignored=True)
    spend(client, headers, bank, "999.00", kind="deposit", on="2026-10-30")
    summary = get(client, headers)["summary"]
    assert summary["month_income"] == "400.00"
    assert summary["planned_spending"] == "4000.00"
    assert summary["planned_balance"] == "-3600.00"
    assert summary["planned_savings_percent"] == "-900.00"


def test_summary_savings_percent_is_zero_without_income(client, headers):
    create(client, headers)
    summary = get(client, headers)["summary"]
    assert (summary["month_income"], summary["planned_balance"], summary["planned_savings_percent"]) == ("0.00", "-4000.00", "0.00")


def test_summary_with_income_above_the_budget_shows_positive_savings(client, headers):
    bank = account(client, headers)
    create(client, headers, income="1000.00", savings_percent="0")
    spend(client, headers, bank, "4000.00", kind="deposit")
    summary = get(client, headers)["summary"]
    assert (summary["planned_balance"], summary["planned_savings_percent"]) == ("3000.00", "75.00")


# ---------- Mudar ----------


def test_patch_changes_only_what_came_and_recomputes(client, headers):
    create(client, headers)
    resp = client.patch(f"{URL}/{MONTH}", json={"income": "6000.00"}, headers=headers)
    assert resp.status_code == 200
    plan = resp.json()
    assert (plan["income"], plan["savings_percent"], plan["spending_budget"]) == ("6000.00", "20.00", "4800.00")
    plan = client.patch(f"{URL}/{MONTH}", json={"savings_percent": "50"}, headers=headers).json()
    assert (plan["income"], plan["spending_budget"]) == ("6000.00", "3000.00")


def test_patch_cannot_lower_the_budget_below_the_limits(client, headers):
    casa = category(client, headers)
    create(client, headers, items=[{"category_id": casa, "amount": "3500.00"}])
    resp = client.patch(f"{URL}/{MONTH}", json={"income": "1000.00"}, headers=headers)
    assert resp.status_code == 400
    assert resp.json()["code"] == "plan_items_exceed_budget"
    assert get(client, headers)["income"] == "5000.00"


def test_patch_of_a_month_without_plan_is_404(client, headers):
    resp = client.patch(f"{URL}/{MONTH}", json={"income": "1.00"}, headers=headers)
    assert resp.status_code == 404
    assert resp.json()["code"] == "monthly_plan_not_found"


def test_put_items_creates_new_limits_and_changes_existing_ones(client, headers):
    casa, lazer = category(client, headers, "Casa"), category(client, headers, "Lazer")
    create(client, headers, items=[{"category_id": casa, "amount": "1000.00"}])
    resp = client.put(
        f"{URL}/{MONTH}/items",
        json={"items": [{"category_id": casa, "amount": "1200.00", "alert": True}, {"category_id": lazer, "amount": "300.00"}]},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    plan = resp.json()
    assert (row(plan, "Casa")["planned"], row(plan, "Casa")["alert"], row(plan, "Lazer")["planned"]) == ("1200.00", True, "300.00")
    assert rest(plan)["planned"] == "2500.00"


def test_put_items_refuses_to_pass_the_budget_and_changes_nothing(client, headers):
    casa, lazer = category(client, headers, "Casa"), category(client, headers, "Lazer")
    create(client, headers, items=[{"category_id": casa, "amount": "3000.00"}])
    resp = client.put(f"{URL}/{MONTH}/items", json={"items": [{"category_id": lazer, "amount": "1500.00"}]}, headers=headers)
    assert resp.status_code == 400
    assert resp.json()["code"] == "plan_items_exceed_budget"
    assert [item["kind"] for item in get(client, headers)["rows"]] == ["category", "rest"]


def test_put_items_needs_a_plan_and_a_list(client, headers):
    casa = category(client, headers)
    body = {"items": [{"category_id": casa, "amount": "10.00"}]}
    assert client.put(f"{URL}/{MONTH}/items", json=body, headers=headers).status_code == 404
    create(client, headers)
    assert client.put(f"{URL}/{MONTH}/items", json={"items": []}, headers=headers).status_code == 422


def test_delete_a_limit(client, headers):
    casa = category(client, headers)
    create(client, headers, items=[{"category_id": casa, "amount": "1000.00"}])
    assert client.delete(f"{URL}/{MONTH}/items/{casa}", headers=headers).status_code == 204
    assert [item["kind"] for item in get(client, headers)["rows"]] == ["rest"]
    again = client.delete(f"{URL}/{MONTH}/items/{casa}", headers=headers)
    assert again.status_code == 404
    assert again.json()["code"] == "plan_item_not_found"


# ---------- Copiar o mes anterior ----------


def test_copy_previous_brings_the_header_and_the_limits(client, headers):
    casa = category(client, headers)
    create(client, headers, month="2026-10", income="6000.00", savings_percent="10", card_counting="invoice", items=[{"category_id": casa, "amount": "800.00", "alert": True}])
    resp = client.post(f"{URL}/{MONTH}/copy-previous", headers=headers)
    assert resp.status_code == 201, resp.text
    plan = resp.json()
    assert plan["month"] == "2026-11-01"
    assert (plan["income"], plan["savings_percent"], plan["card_counting"]) == ("6000.00", "10.00", "invoice")
    assert (row(plan, "Casa")["planned"], row(plan, "Casa")["alert"]) == ("800.00", True)
    # A copia e independente da origem
    client.put(f"{URL}/{MONTH}/items", json={"items": [{"category_id": casa, "amount": "900.00"}]}, headers=headers)
    assert row(get(client, headers, "2026-10"), "Casa")["planned"] == "800.00"


def test_copy_previous_wraps_from_january_to_december(client, headers):
    create(client, headers, month="2025-12")
    assert client.post(f"{URL}/2026-01/copy-previous", headers=headers).status_code == 201


def test_copy_previous_without_a_previous_plan_is_404(client, headers):
    resp = client.post(f"{URL}/{MONTH}/copy-previous", headers=headers)
    assert resp.status_code == 404
    assert resp.json()["code"] == "monthly_plan_not_found"


def test_copy_previous_into_a_month_that_has_a_plan_is_409(client, headers):
    create(client, headers, month="2026-10")
    create(client, headers)
    assert client.post(f"{URL}/{MONTH}/copy-previous", headers=headers).status_code == 409


# ---------- Apagar e isolamento ----------


def test_delete_one_month(client, headers):
    create(client, headers)
    assert client.delete(f"{URL}/{MONTH}", headers=headers).status_code == 204
    assert client.get(f"{URL}/{MONTH}", headers=headers).status_code == 404
    assert client.delete(f"{URL}/{MONTH}", headers=headers).status_code == 404


def test_delete_all_plans_leaves_transactions_and_categories(client, headers):
    bank, casa = account(client, headers), category(client, headers)
    create(client, headers, items=[{"category_id": casa, "amount": "100.00"}])
    create(client, headers, month="2026-12")
    spend(client, headers, bank, "10.00", category_id=casa)
    assert client.delete(URL, headers=headers).status_code == 204
    assert client.get(f"{URL}/{MONTH}", headers=headers).status_code == 404
    assert client.get(f"{URL}/2026-12", headers=headers).status_code == 404
    assert len(client.get(TX, headers=headers).json()["items"]) == 1
    assert client.get(f"/api/v1/categories/{casa}", headers=headers).status_code == 200


def test_plans_are_private_to_each_user(client, headers, db_session):
    create(client, headers)
    other = other_headers(client, db_session)
    assert client.get(f"{URL}/{MONTH}", headers=other).status_code == 404
    assert client.delete(f"{URL}/{MONTH}", headers=other).status_code == 404
    assert create(client, other).status_code == 201
    client.delete(URL, headers=other)
    assert client.get(f"{URL}/{MONTH}", headers=headers).status_code == 200


def test_another_users_spending_never_counts(client, headers, db_session):
    other = other_headers(client, db_session)
    spend(client, other, account(client, other, name="Dela"), "999.00")
    create(client, headers)
    assert get(client, headers)["summary"]["spent_total"] == "0.00"


# ---------- Migration ----------


def test_migration_0039_creates_the_plan_tables_and_keeps_existing_data(clean_schema):
    config = alembic_config()
    command.upgrade(config, "0038")
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, name, email, hashed_password) "
                "VALUES ('13131313-1313-4131-8131-131313131313', 'Ana', 'ana9@example.com', 'x')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO categories (id, user_id, name, kind) VALUES "
                "('14141414-1414-4141-8141-141414141414', '13131313-1313-4131-8131-131313131313', 'Casa', 'expense')"
            )
        )

    command.upgrade(config, "head")

    with engine.connect() as conn:
        categories = conn.execute(text("SELECT count(*) FROM categories")).scalar()
        plans = conn.execute(text("SELECT count(*) FROM monthly_plans")).scalar()
        items = conn.execute(text("SELECT count(*) FROM monthly_plan_items")).scalar()
    assert (categories, plans, items) == (1, 0, 0)


def test_amounts_are_exact_decimals(client, headers):
    bank, casa = account(client, headers), category(client, headers)
    create(client, headers, income="1000.10", savings_percent="33.33", items=[{"category_id": casa, "amount": "100.10"}])
    spend(client, headers, bank, "0.10", category_id=casa)
    spend(client, headers, bank, "0.20", category_id=casa)
    plan = get(client, headers)
    assert Decimal(row(plan, "Casa")["total"]) == Decimal("0.30")
    assert plan["spending_budget"] == "666.77"
