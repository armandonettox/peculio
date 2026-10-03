from datetime import date

import pytest
from sqlalchemy import event, select

from app.core import clock
from app.core.database import engine
from app.models.recurrence import Recurrence
from tests.conftest import auth_headers, make_user, register

URL = "/api/v1/dashboard/upcoming"
BILLS_URL = "/api/v1/bills"
RECURRENCES_URL = "/api/v1/recurrences"
ACCOUNTS_URL = "/api/v1/accounts"
TX_URL = "/api/v1/transactions"

# Segunda-feira, dia fixo do relogio do app
TODAY = date(2026, 6, 15)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "today", lambda now=None: TODAY)


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_account(client, headers, name="Nubank", currency="BRL", kind="asset"):
    body = {"name": name, "type": kind, "currency_code": currency, "opening_balance": "5000", "opening_balance_date": "2026-01-01"}
    resp = client.post(ACCOUNTS_URL, json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


@pytest.fixture
def account_id(client, headers):
    return make_account(client, headers)


def make_bill(client, headers, name="Netflix", first="2026-06-20", frequency="monthly", **overrides):
    body = {
        "name": name,
        "currency_code": "BRL",
        "amount_min": "40.00",
        "amount_max": "60.00",
        "first_due_date": first,
        "frequency": frequency,
        **overrides,
    }
    resp = client.post(BILLS_URL, json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def pay_bill(client, headers, account_id, bill_id, on, amount="50.00"):
    split = {
        "type": "withdrawal",
        "date": on,
        "description": "Pagamento ficticio",
        "amount": amount,
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Empresa Exemplo",
        "bill_id": bill_id,
    }
    resp = client.post(TX_URL, json={"splits": [split]}, headers=headers)
    assert resp.status_code == 201, resp.text


def recurrence_split(account_id, kind="withdrawal", amount="1000.00", currency="BRL", **extra):
    split = {
        "type": kind,
        "date": "2026-01-01",
        "description": "Modelo ficticio",
        "amount": amount,
        "currency_code": currency,
        "account_id": account_id,
        **extra,
    }
    if "counterparty_account_id" not in split:
        split["counterparty_name"] = "Contraparte Exemplo"
    return split


def make_recurrence(client, headers, account_id, name="Aluguel", first="2026-06-20", frequency="monthly", splits=None, **extra):
    body = {
        "name": name,
        "frequency": frequency,
        "first_date": first,
        "template": {"splits": splits or [recurrence_split(account_id)]},
        **extra,
    }
    resp = client.post(RECURRENCES_URL, json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def get(client, headers, **params):
    return client.get(URL, params=params, headers=headers)


def items_of(client, headers, **params):
    resp = get(client, headers, **params)
    assert resp.status_code == 200, resp.text
    return resp.json()["items"]


def names(items):
    return [item["name"] for item in items]


# ---------- Forma da resposta ----------


def test_empty_response(client, headers):
    resp = get(client, headers)
    assert resp.status_code == 200
    assert resp.json() == {"as_of": "2026-06-15", "days": 30, "items": []}


def test_bill_item_has_all_the_fields(client, headers):
    bill_id = make_bill(client, headers, first="2026-06-20")
    body = get(client, headers).json()
    assert body["as_of"] == "2026-06-15"
    assert body["days"] == 30
    assert body["items"] == [
        {
            "kind": "bill",
            "id": bill_id,
            "name": "Netflix",
            "date": "2026-06-20",
            "days_until": 5,
            "overdue": False,
            "direction": "out",
            "currency_code": "BRL",
            "amount_min": "40.00",
            "amount_max": "60.00",
        }
    ]


def test_as_of_and_days_until_come_from_the_app_clock(client, headers, monkeypatch):
    make_bill(client, headers, first="2026-06-20")
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 6, 18))
    body = get(client, headers).json()
    assert body["as_of"] == "2026-06-18"
    assert body["items"][0]["days_until"] == 2


# ---------- Contas a pagar ----------


def test_overdue_bill_has_negative_days_and_the_last_due_date(client, headers):
    make_bill(client, headers, first="2026-01-20")
    (item,) = items_of(client, headers, days=1)
    assert item["date"] == "2026-05-20"
    assert item["days_until"] == -26
    assert item["overdue"] is True


def test_overdue_bill_is_listed_even_far_outside_the_window(client, headers):
    make_bill(client, headers, first="2026-06-01", frequency="monthly")
    (item,) = items_of(client, headers, days=1)
    assert item["overdue"] is True
    assert item["date"] == "2026-06-01"


def test_paid_bill_is_not_overdue_and_shows_the_next_due_date(client, headers, account_id):
    bill_id = make_bill(client, headers, first="2026-01-20")
    pay_bill(client, headers, account_id, bill_id, "2026-05-20")
    (item,) = items_of(client, headers)
    assert item["overdue"] is False
    assert item["date"] == "2026-06-20"
    assert item["days_until"] == 5


def test_bill_due_today_and_unpaid_is_not_overdue(client, headers):
    make_bill(client, headers, first="2026-06-15")
    (item,) = items_of(client, headers)
    assert (item["date"], item["days_until"], item["overdue"]) == ("2026-06-15", 0, False)


def test_bill_due_today_and_paid_shows_the_next_one(client, headers, account_id):
    bill_id = make_bill(client, headers, first="2026-06-15")
    pay_bill(client, headers, account_id, bill_id, "2026-06-15")
    (item,) = items_of(client, headers)
    assert (item["date"], item["days_until"]) == ("2026-07-15", 30)


def test_window_includes_the_last_day_and_excludes_the_day_after(client, headers):
    make_bill(client, headers, first="2026-06-15", name="Hoje")
    make_bill(client, headers, first="2026-07-10", name="No limite")
    make_bill(client, headers, first="2026-07-11", name="Depois do limite")
    found = items_of(client, headers, days=25)
    # Hoje (nao paga) e o vencimento do dia 10/07 (25 dias); o de 11/07 fica fora
    assert names(found) == ["Hoje", "No limite"]


def test_bill_outside_the_window_is_left_out_until_the_window_grows(client, headers):
    make_bill(client, headers, first="2026-08-01")
    assert items_of(client, headers, days=30) == []
    assert names(items_of(client, headers, days=60)) == ["Netflix"]


def test_next_due_already_paid_in_advance_is_not_listed(client, headers, account_id):
    bill_id = make_bill(client, headers, first="2026-05-20")
    pay_bill(client, headers, account_id, bill_id, "2026-05-20")
    pay_bill(client, headers, account_id, bill_id, "2026-06-18")
    assert items_of(client, headers) == []


def test_archived_bill_is_ignored_even_when_overdue(client, headers):
    bill_id = make_bill(client, headers, first="2026-01-20")
    make_bill(client, headers, name="Ativa", first="2026-06-25")
    client.patch(f"{BILLS_URL}/{bill_id}", json={"active": False}, headers=headers)
    assert names(items_of(client, headers)) == ["Ativa"]


def test_overdue_bill_has_a_single_entry_even_when_the_next_due_is_in_the_window(client, headers):
    # Vencimentos de 02/06, 09/06 (sem pagamento) e 16/06 (dentro da janela)
    make_bill(client, headers, first="2026-06-02", frequency="weekly")
    (item,) = items_of(client, headers, days=30)
    assert (item["date"], item["days_until"], item["overdue"]) == ("2026-06-09", -6, True)


def test_weekly_bill_next_due(client, headers, account_id):
    bill_id = make_bill(client, headers, first="2026-06-01", frequency="weekly")
    pay_bill(client, headers, account_id, bill_id, "2026-06-15")
    (item,) = items_of(client, headers, days=10)
    assert (item["date"], item["days_until"]) == ("2026-06-22", 7)


def test_bill_amounts_use_the_currency_decimal_places(client, headers):
    make_bill(client, headers, first="2026-06-20", currency_code="JPY", amount_min="1500", amount_max="1800")
    (item,) = items_of(client, headers)
    assert (item["currency_code"], item["amount_min"], item["amount_max"]) == ("JPY", "1500", "1800")


# ---------- Recorrentes ----------


def test_active_recurrence_shows_its_next_occurrence(client, headers, account_id):
    recurrence_id = make_recurrence(client, headers, account_id, first="2026-06-20")
    (item,) = items_of(client, headers)
    assert item == {
        "kind": "recurrence",
        "id": recurrence_id,
        "name": "Aluguel",
        "date": "2026-06-20",
        "days_until": 5,
        "overdue": False,
        "direction": "out",
        "currency_code": "BRL",
        "amount_min": "1000.00",
        "amount_max": "1000.00",
    }


def test_recurrence_that_already_started_shows_the_following_date(client, headers, account_id):
    make_recurrence(client, headers, account_id, first="2026-05-10")
    (item,) = items_of(client, headers)
    # As ocorrencias de 10/05 e 10/06 ja foram criadas; falta a de 10/07
    assert (item["date"], item["days_until"]) == ("2026-07-10", 25)


def test_directions_follow_the_type_of_the_first_split(client, headers, account_id):
    other = make_account(client, headers, name="Poupanca")
    make_recurrence(client, headers, account_id, name="Saida", first="2026-06-20")
    make_recurrence(
        client,
        headers,
        account_id,
        name="Entrada",
        first="2026-06-21",
        splits=[recurrence_split(account_id, kind="deposit", amount="3000.00")],
    )
    make_recurrence(
        client,
        headers,
        account_id,
        name="Transferencia",
        first="2026-06-22",
        splits=[recurrence_split(account_id, kind="transfer", amount="200.00", counterparty_account_id=other)],
    )
    directions = {item["name"]: item["direction"] for item in items_of(client, headers)}
    assert directions == {"Saida": "out", "Entrada": "in", "Transferencia": "transfer"}


def test_amount_is_the_sum_of_the_splits_in_the_currency_of_the_first(client, headers, account_id):
    make_recurrence(
        client,
        headers,
        account_id,
        splits=[
            recurrence_split(account_id, amount="10.10"),
            recurrence_split(account_id, amount="5.05"),
        ],
    )
    (item,) = items_of(client, headers)
    assert (item["amount_min"], item["amount_max"]) == ("15.15", "15.15")


def test_amount_gets_the_decimal_places_of_the_currency(client, headers, account_id):
    make_recurrence(client, headers, account_id, splits=[recurrence_split(account_id, amount="7")])
    (item,) = items_of(client, headers)
    assert (item["amount_min"], item["amount_max"]) == ("7.00", "7.00")


def test_occurrence_due_today_that_the_scheduler_has_not_created_yet_is_listed(client, headers, account_id, monkeypatch):
    make_recurrence(client, headers, account_id, first="2026-06-20")
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 6, 20))
    (item,) = items_of(client, headers)
    assert (item["date"], item["days_until"], item["overdue"]) == ("2026-06-20", 0, False)


def test_splits_in_other_currencies_are_not_added_to_the_amount(client, headers, account_id):
    usd = make_account(client, headers, name="Dolares", currency="USD")
    make_recurrence(
        client,
        headers,
        account_id,
        splits=[
            recurrence_split(account_id, amount="10.00"),
            recurrence_split(account_id, amount="0.50"),
            recurrence_split(usd, amount="7.00", currency="USD"),
        ],
    )
    (item,) = items_of(client, headers)
    assert (item["currency_code"], item["amount_min"], item["amount_max"]) == ("BRL", "10.50", "10.50")


def test_recurrence_in_another_currency_keeps_its_currency_and_decimals(client, headers):
    jpy = make_account(client, headers, name="Ienes", currency="JPY")
    make_recurrence(client, headers, jpy, splits=[recurrence_split(jpy, amount="1500", currency="JPY")])
    (item,) = items_of(client, headers)
    assert (item["currency_code"], item["amount_min"]) == ("JPY", "1500")


def test_paused_recurrence_is_left_out(client, headers, account_id):
    recurrence_id = make_recurrence(client, headers, account_id, first="2026-06-20")
    resp = client.patch(f"{RECURRENCES_URL}/{recurrence_id}", json={"active": False}, headers=headers)
    assert resp.status_code == 200
    assert items_of(client, headers) == []


def test_ended_recurrence_is_left_out(client, headers, account_id):
    make_recurrence(client, headers, account_id, first="2026-06-01", max_occurrences=1)
    assert items_of(client, headers) == []


def test_recurrence_ending_before_the_next_date_is_left_out(client, headers, account_id):
    make_recurrence(client, headers, account_id, first="2026-06-01", end_date="2026-06-30")
    assert items_of(client, headers) == []


def test_recurrence_window_edges(client, headers, account_id):
    make_recurrence(client, headers, account_id, name="Hoje", first="2026-06-15")
    make_recurrence(client, headers, account_id, name="No limite", first="2026-07-15")
    make_recurrence(client, headers, account_id, name="Depois", first="2026-07-16")
    items = items_of(client, headers, days=30)
    # "Hoje" ja gerou o lancamento do dia 15 e a proxima e 15/07, igual a "No limite"
    assert sorted(names(items)) == ["Hoje", "No limite"]
    assert sorted(item["date"] for item in items) == ["2026-07-15", "2026-07-15"]


def test_occurrence_the_scheduler_has_not_created_yet_is_left_out(client, headers, account_id, monkeypatch):
    make_recurrence(client, headers, account_id, first="2026-06-20")
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 6, 25))
    assert items_of(client, headers) == []


def test_recurrence_with_a_broken_template_does_not_break_the_panel(client, headers, account_id, db_session):
    make_recurrence(client, headers, account_id, name="Quebrada", first="2026-06-20")
    make_recurrence(client, headers, account_id, name="Boa", first="2026-06-21")
    broken = db_session.execute(select(Recurrence).where(Recurrence.name == "Quebrada")).scalar_one()
    broken.template = {"splits": []}
    db_session.commit()
    assert names(items_of(client, headers)) == ["Boa"]


# ---------- Ordem e teto ----------


def test_overdue_first_then_by_date_and_by_name(client, headers, account_id):
    make_bill(client, headers, name="Atrasada recente", first="2026-06-10")
    make_bill(client, headers, name="Atrasada antiga", first="2026-04-02", frequency="yearly")
    make_bill(client, headers, name="zeta", first="2026-06-18")
    make_recurrence(client, headers, account_id, name="Beta", first="2026-06-18")
    make_recurrence(client, headers, account_id, name="alfa", first="2026-06-18")
    make_recurrence(client, headers, account_id, name="Cedo", first="2026-06-16")
    items = items_of(client, headers)
    assert names(items) == ["Atrasada antiga", "Atrasada recente", "Cedo", "alfa", "Beta", "zeta"]
    assert [item["overdue"] for item in items] == [True, True, False, False, False, False]


def test_mixed_kinds_on_the_same_date_sort_by_name(client, headers, account_id):
    make_bill(client, headers, name="B conta", first="2026-06-20")
    make_recurrence(client, headers, account_id, name="A recorrente", first="2026-06-20")
    assert names(items_of(client, headers)) == ["A recorrente", "B conta"]


def test_at_most_fifty_items_and_the_overdue_ones_survive_the_cut(client, headers, account_id):
    make_bill(client, headers, name="Atrasada 1", first="2026-04-02", frequency="yearly")
    make_bill(client, headers, name="Atrasada 2", first="2026-05-02", frequency="yearly")
    for index in range(52):
        make_recurrence(client, headers, account_id, name=f"Rec {index:02d}", first="2026-06-20")
    items = items_of(client, headers, days=90)
    assert len(items) == 50
    assert names(items)[:2] == ["Atrasada 1", "Atrasada 2"]
    assert names(items)[2:] == [f"Rec {index:02d}" for index in range(48)]


# ---------- Isolamento, parametros e autenticacao ----------


def test_other_users_items_never_show_up(client, headers, account_id, db_session):
    make_bill(client, headers, name="Minha", first="2026-06-20")
    make_recurrence(client, headers, account_id, name="Minha recorrente", first="2026-06-21")
    make_user(db_session, email="outro@example.com")
    other = auth_headers(client, email="outro@example.com")
    other_account = make_account(client, other, name="Dele")
    make_bill(client, other, name="Dele", first="2026-01-01")
    make_recurrence(client, other, other_account, name="Dele recorrente", first="2026-06-22")
    assert sorted(names(items_of(client, headers))) == ["Minha", "Minha recorrente"]
    assert sorted(names(items_of(client, other))) == ["Dele", "Dele recorrente"]


@pytest.mark.parametrize("days", ["0", "91", "-1", "abc", "2.5", ""])
def test_invalid_days_are_rejected(client, headers, days):
    assert get(client, headers, days=days).status_code == 422


@pytest.mark.parametrize("days", [1, 90])
def test_limits_of_days_are_accepted(client, headers, days):
    resp = get(client, headers, days=days)
    assert resp.status_code == 200
    assert resp.json()["days"] == days


def test_authentication_is_required(client):
    assert client.get(URL).status_code == 401
    assert client.get(URL, headers={"Authorization": "Bearer invalido"}).status_code == 401


# ---------- Desempenho ----------


def count_statements(client, headers, **params):
    statements: list[str] = []

    def record(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        assert get(client, headers, **params).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return len(statements)


def test_number_of_queries_does_not_grow_with_bills_or_recurrences(client, headers, account_id):
    make_bill(client, headers, name="Primeira", first="2026-06-20")
    make_recurrence(client, headers, account_id, name="Primeira rec", first="2026-06-20")
    small = count_statements(client, headers)
    for index in range(6):
        make_bill(client, headers, name=f"Conta {index}", first="2026-01-05")
        make_recurrence(client, headers, account_id, name=f"Rec {index}", first=f"2026-06-2{index}")
    assert count_statements(client, headers) == small
    assert count_statements(client, headers, days=90) == small
