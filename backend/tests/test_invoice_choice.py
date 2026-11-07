"""Fatura escolhida na compra do cartao (invoice_date).

Nula, a compra entra na fatura da propria data, como sempre foi. Com uma data de fatura, ela entra na fatura que contem
essa data, mesmo com a data da compra em outro mes: o mesmo comportamento do Mobills.
"""

from datetime import date

import pytest
from alembic import command
from sqlalchemy import text

from app.core import clock
from app.core.database import engine
from app.schemas.transaction import TransactionCreate, TransactionSplitCreate
from app.services.recurrences import _at
from tests.conftest import alembic_config, auth_headers, make_user, register

ACCOUNTS_URL = "/api/v1/accounts"
TX_URL = "/api/v1/transactions"
TODAY = date(2026, 11, 7)


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    # Com o fechamento no dia 28, hoje (7/11) cai na fatura que fecha em 28/11 e vence em 5/12
    monkeypatch.setattr(clock, "today", lambda now=None: TODAY)


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_card(client, headers, name="Cartao", **overrides):
    body = {"name": name, "type": "asset", "currency_code": "BRL", "role": "credit_card", "closing_day": 28, "due_day": 5}
    return client.post(ACCOUNTS_URL, json={**body, **overrides}, headers=headers).json()["id"]


def make_bank(client, headers):
    body = {"name": "Itau", "type": "asset", "currency_code": "BRL", "opening_balance": "1000.00"}
    return client.post(ACCOUNTS_URL, json=body, headers=headers).json()["id"]


def split(account_id, amount="100.00", on="2026-11-07", kind="withdrawal", **extra):
    return {
        "type": kind,
        "date": on,
        "description": "Compra",
        "amount": amount,
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Loja",
        **extra,
    }


def buy(client, headers, account_id, amount="100.00", on="2026-11-07", **extra):
    resp = client.post(TX_URL, json={"splits": [split(account_id, amount, on, **extra)]}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def invoice(client, headers, account_id, on):
    resp = client.get(f"{ACCOUNTS_URL}/{account_id}/invoice", params={"on": on}, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def options(client, headers, account_id, **params):
    resp = client.get(f"{ACCOUNTS_URL}/{account_id}/invoices", params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------- Fatura da compra ----------


def test_without_invoice_date_the_purchase_stays_in_the_invoice_of_its_date(client, headers):
    card = make_card(client, headers)
    out = buy(client, headers, card)
    assert out["splits"][0]["invoice_date"] is None
    assert invoice(client, headers, card, "2026-11-07")["total"] == "100.00"
    assert invoice(client, headers, card, "2026-12-28")["total"] == "0.00"


def test_the_chosen_invoice_wins_over_the_date_of_the_purchase(client, headers):
    card = make_card(client, headers)
    out = buy(client, headers, card, invoice_date="2026-12-28")
    # A data da compra continua a mesma; so a fatura muda
    assert out["splits"][0]["date"] == "2026-11-07"
    assert out["splits"][0]["invoice_date"] == "2026-12-28"
    assert invoice(client, headers, card, "2026-11-07")["total"] == "0.00"
    chosen = invoice(client, headers, card, "2026-12-28")
    assert chosen["total"] == "100.00"
    assert [item["date"] for item in chosen["splits"]] == ["2026-11-07"]


def test_any_date_inside_the_invoice_picks_that_invoice(client, headers):
    card = make_card(client, headers)
    buy(client, headers, card, invoice_date="2026-12-10")
    assert invoice(client, headers, card, "2026-12-28")["total"] == "100.00"


def test_edit_can_change_and_clear_the_invoice(client, headers):
    card = make_card(client, headers)
    out = buy(client, headers, card)
    body = {"splits": [split(card, invoice_date="2027-01-28")]}
    edited = client.put(f"{TX_URL}/{out['id']}", json=body, headers=headers).json()
    assert edited["splits"][0]["invoice_date"] == "2027-01-28"
    assert invoice(client, headers, card, "2027-01-28")["total"] == "100.00"

    back = client.put(f"{TX_URL}/{out['id']}", json={"splits": [split(card)]}, headers=headers).json()
    assert back["splits"][0]["invoice_date"] is None
    assert invoice(client, headers, card, "2026-11-07")["total"] == "100.00"


def test_listing_returns_the_invoice_date(client, headers):
    card = make_card(client, headers)
    buy(client, headers, card, invoice_date="2026-12-28")
    [item] = client.get(TX_URL, headers=headers).json()["items"]
    assert item["splits"][0]["invoice_date"] == "2026-12-28"


def test_invoice_date_is_refused_outside_a_credit_card_purchase(client, headers):
    bank = make_bank(client, headers)
    resp = client.post(TX_URL, json={"splits": [split(bank, invoice_date="2026-12-28")]}, headers=headers)
    assert resp.status_code == 400
    assert resp.json()["code"] == "account_not_credit_card"

    card = make_card(client, headers)
    deposit = split(card, kind="deposit", invoice_date="2026-12-28")
    resp = client.post(TX_URL, json={"splits": [deposit]}, headers=headers)
    assert resp.status_code == 400
    assert resp.json()["code"] == "account_not_credit_card"


def test_invoice_date_must_be_a_valid_date(client, headers):
    card = make_card(client, headers)
    resp = client.post(TX_URL, json={"splits": [split(card, invoice_date="amanha")]}, headers=headers)
    assert resp.status_code == 422


# ---------- Parcelas ----------


def test_installments_follow_the_chosen_invoice_month_by_month(client, headers):
    card = make_card(client, headers)
    resp = client.post(
        TX_URL, json={"splits": [split(card, "300.00", invoice_date="2026-12-28")], "installments": 3}, headers=headers
    )
    assert resp.status_code == 201, resp.text
    for invoice_day in ("2026-12-28", "2027-01-28", "2027-02-28"):
        assert invoice(client, headers, card, invoice_day)["total"] == "100.00"
    # A data da primeira parcela e a da compra; nada caiu na fatura da data
    assert invoice(client, headers, card, "2026-11-07")["total"] == "0.00"


def test_installments_without_a_chosen_invoice_keep_the_old_behavior(client, headers):
    card = make_card(client, headers)
    resp = client.post(TX_URL, json={"splits": [split(card, "300.00")], "installments": 3}, headers=headers)
    assert resp.status_code == 201, resp.text
    for invoice_day in ("2026-11-07", "2026-12-07", "2027-01-07"):
        assert invoice(client, headers, card, invoice_day)["total"] == "100.00"


# ---------- Recorrente, duplicar e mudar a data ----------


def test_a_recurring_template_moves_the_invoice_with_the_date():
    template = TransactionCreate(
        splits=[
            TransactionSplitCreate(
                type="withdrawal",
                date=date(2026, 11, 7),
                description="Assinatura",
                amount="30.00",
                currency_code="BRL",
                account_id="11111111-1111-4111-8111-111111111111",
                counterparty_name="Streaming",
                invoice_date=date(2026, 12, 28),
            )
        ]
    )
    moved = _at(template, date(2027, 1, 7))
    # Mesma distancia da data da compra: 7/11 -> 28/12 vira 7/1 -> 27/2
    assert moved.splits[0].date == date(2027, 1, 7)
    assert moved.splits[0].invoice_date == date(2027, 2, 27)


def test_a_recurring_template_without_invoice_stays_without_it():
    template = TransactionCreate(
        splits=[
            TransactionSplitCreate(
                type="withdrawal",
                date=date(2026, 11, 7),
                description="Assinatura",
                amount="30.00",
                currency_code="BRL",
                account_id="11111111-1111-4111-8111-111111111111",
                counterparty_name="Streaming",
            )
        ]
    )
    assert _at(template, date(2027, 1, 7)).splits[0].invoice_date is None


def test_duplicating_does_not_copy_the_chosen_invoice(client, headers):
    card = make_card(client, headers)
    out = buy(client, headers, card, invoice_date="2026-12-28")
    resp = client.post(f"{TX_URL}/bulk", json={"ids": [out["id"]], "action": "duplicate"}, headers=headers)
    assert resp.status_code == 200, resp.text
    copy = client.get(f"{TX_URL}/{resp.json()['created_ids'][0]}", headers=headers).json()
    assert copy["splits"][0]["invoice_date"] is None


def test_changing_the_date_in_bulk_clears_the_chosen_invoice(client, headers):
    card = make_card(client, headers)
    out = buy(client, headers, card, invoice_date="2026-12-28")
    resp = client.post(
        f"{TX_URL}/bulk", json={"ids": [out["id"]], "action": "set_date", "date": "2026-11-20"}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    after = client.get(f"{TX_URL}/{out['id']}", headers=headers).json()
    assert after["splits"][0]["invoice_date"] is None
    assert invoice(client, headers, card, "2026-11-20")["total"] == "100.00"


# ---------- Faturas para escolher ----------


def test_options_show_two_past_invoices_the_open_one_and_the_next_six(client, headers):
    card = make_card(client, headers)
    items = options(client, headers, card)
    assert len(items) == 9
    assert [item["period_end"] for item in items] == sorted(item["period_end"] for item in items)
    assert [item["status"] for item in items] == ["zero", "zero", "open"] + ["partial"] * 6
    open_one = items[2]
    assert (open_one["period_start"], open_one["period_end"], open_one["due_date"]) == (
        "2026-10-29",
        "2026-11-28",
        "2026-12-05",
    )


def test_options_totals_and_statuses_follow_the_purchases(client, headers):
    card = make_card(client, headers)
    buy(client, headers, card, "40.00", on="2026-10-10")
    buy(client, headers, card, "25.00", on="2026-11-07")
    buy(client, headers, card, "10.00", on="2026-11-07", invoice_date="2027-01-28")
    by_end = {item["period_end"]: item for item in options(client, headers, card)}
    assert (by_end["2026-10-28"]["status"], by_end["2026-10-28"]["total"]) == ("closed", "40.00")
    assert (by_end["2026-11-28"]["status"], by_end["2026-11-28"]["total"]) == ("open", "25.00")
    # A compra com fatura escolhida conta na fatura escolhida, nao na da data
    assert by_end["2027-01-28"]["total"] == "10.00"
    assert by_end["2026-12-28"]["total"] == "0.00"


def test_options_include_the_invoice_of_a_date_outside_the_window(client, headers):
    card = make_card(client, headers)
    items = options(client, headers, card, around="2025-03-10")
    assert len(items) == 10
    assert items[0]["period_end"] == "2025-03-28"
    assert items[0]["status"] == "zero"


def test_options_do_not_repeat_an_invoice_already_in_the_window(client, headers):
    card = make_card(client, headers)
    assert len(options(client, headers, card, around="2026-12-01")) == 9


def test_options_for_a_closing_day_at_the_end_of_the_month(client, headers):
    card = make_card(client, headers, closing_day=31, due_day=10)
    ends = [item["period_end"] for item in options(client, headers, card)]
    assert "2026-11-30" in ends and "2026-12-31" in ends and "2027-02-28" in ends


def test_options_only_for_a_credit_card(client, headers):
    bank = make_bank(client, headers)
    resp = client.get(f"{ACCOUNTS_URL}/{bank}/invoices", headers=headers)
    assert resp.status_code == 400
    assert resp.json()["code"] == "account_not_credit_card"


def test_options_of_another_users_card_are_404(client, headers, db_session):
    card = make_card(client, headers)
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    assert client.get(f"{ACCOUNTS_URL}/{card}/invoices", headers=other).status_code == 404


def test_options_require_login(client):
    assert client.get(f"{ACCOUNTS_URL}/11111111-1111-4111-8111-111111111111/invoices").status_code == 401


# ---------- Migration ----------


def test_migration_0038_keeps_existing_purchases_without_a_chosen_invoice(clean_schema):
    """Quem ja tinha compras antes da coluna nao ve nenhuma fatura mudar: a coluna nasce nula."""
    config = alembic_config()
    command.upgrade(config, "0037")
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, name, email, hashed_password) "
                "VALUES ('12121212-1212-4121-8121-121212121212', 'Ana', 'ana8@example.com', 'x')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO currencies (code, name, symbol, decimal_places) VALUES ('BRL', 'Real', 'R$', 2) ON CONFLICT DO NOTHING"
            )
        )
        for account_id, name, kind in [
            ("a3333333-3333-4333-8333-333333333333", "Cartao", "asset"),
            ("a4444444-4444-4444-8444-444444444444", "Loja", "expense"),
        ]:
            conn.execute(
                text(
                    "INSERT INTO accounts (id, user_id, name, type, currency_code) VALUES "
                    f"('{account_id}', '12121212-1212-4121-8121-121212121212', '{name}', '{kind}', 'BRL')"
                )
            )
        conn.execute(
            text(
                "INSERT INTO transactions (id, user_id) VALUES "
                "('b3333333-3333-4333-8333-333333333333', '12121212-1212-4121-8121-121212121212')"
            )
        )
        conn.execute(
            text(
                "INSERT INTO transaction_splits (id, transaction_id, user_id, type, date, description, "
                "source_account_id, destination_account_id, amount, currency_code) VALUES "
                "('c3333333-3333-4333-8333-333333333333', 'b3333333-3333-4333-8333-333333333333', "
                "'12121212-1212-4121-8121-121212121212', 'withdrawal', '2026-03-10', 'Compra', "
                "'a3333333-3333-4333-8333-333333333333', 'a4444444-4444-4444-8444-444444444444', 12.50, 'BRL')"
            )
        )

    command.upgrade(config, "head")

    with engine.connect() as conn:
        row = conn.execute(text("SELECT description, amount, invoice_date FROM transaction_splits")).one()
    assert (row.description, float(row.amount), row.invoice_date) == ("Compra", 12.5, None)
