import uuid

import pytest

from tests.conftest import auth_headers, make_user, register

URL = "/api/v1/bills"
TX_URL = "/api/v1/transactions"
ACCOUNTS_URL = "/api/v1/accounts"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_bill(client, headers, **overrides):
    body = {
        "name": "Netflix",
        "currency_code": "BRL",
        "amount_min": "40.00",
        "amount_max": "60.00",
        "match_text": "netflix",
        "first_due_date": "2026-03-05",
        "frequency": "monthly",
        **overrides,
    }
    return client.post(URL, json=body, headers=headers)


def make_account(client, headers, **overrides):
    body = {"name": "Nubank", "type": "asset", "currency_code": "BRL", "opening_balance": "5000.00", **overrides}
    return client.post(ACCOUNTS_URL, json=body, headers=headers).json()["id"]


def spend(client, headers, account_id, amount="50.00", on="2026-03-06", description="Assinatura Netflix", **overrides):
    split = {
        "type": "withdrawal",
        "date": on,
        "description": description,
        "amount": amount,
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Streaming",
        **overrides,
    }
    return client.post(TX_URL, json={"splits": [split]}, headers=headers)


def status(client, headers, **params):
    return client.get(f"{URL}/status", params=params, headers=headers)


def bill_id_of(response):
    return response.json()["splits"][0]["bill_id"]


# ---------- CRUD ----------


def test_requires_login(client):
    assert client.get(URL).status_code == 401
    assert client.post(URL, json={}).status_code == 401
    assert client.get(f"{URL}/status").status_code == 401


def test_create_returns_the_bill(client, headers):
    resp = make_bill(client, headers, name="  Netflix ", match_text="  netflix  ")
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Netflix"
    assert body["match_text"] == "netflix"
    assert (body["amount_min"], body["amount_max"]) == ("40.00", "60.00")
    assert body["frequency"] == "monthly"
    assert body["first_due_date"] == "2026-03-05"
    assert body["active"] is True


def test_blank_match_text_means_no_automatic_link(client, headers):
    assert make_bill(client, headers, match_text="   ").json()["match_text"] is None
    assert make_bill(client, headers, name="B", match_text=None).json()["match_text"] is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"amount_min": "0"},
        {"amount_min": "-1"},
        {"amount_max": "0"},
        {"amount_min": "70.00", "amount_max": "60.00"},
        {"amount_min": "abc"},
        {"amount_min": "10.555"},
        {"name": ""},
        {"name": "  "},
        {"frequency": "daily"},
        {"first_due_date": "05/03/2026"},
        {"first_due_date": "2026-02-30"},
        {"currency_code": "BR"},
        {"unknown": 1},
    ],
)
def test_create_validation_returns_422(client, headers, overrides):
    assert make_bill(client, headers, **overrides).status_code == 422


def test_min_equal_to_max_is_a_fixed_price(client, headers):
    assert make_bill(client, headers, amount_min="49.90", amount_max="49.90").status_code == 201


def test_unknown_currency_and_decimal_places(client, headers):
    unknown = make_bill(client, headers, currency_code="XXX")
    assert unknown.status_code == 400 and unknown.json()["code"] == "currency_not_found"
    places = make_bill(client, headers, currency_code="JPY", amount_min="100.5", amount_max="200")
    assert places.status_code == 400 and places.json()["code"] == "invalid_amount"
    ok = make_bill(client, headers, name="Iene", currency_code="JPY", amount_min="100", amount_max="200")
    assert ok.status_code == 201 and ok.json()["amount_min"] == "100"


def test_name_is_unique_per_user_ignoring_case(client, headers, db_session):
    make_bill(client, headers, name="Netflix")
    resp = make_bill(client, headers, name="NETFLIX")
    assert resp.status_code == 409 and resp.json()["code"] == "bill_name_taken"

    make_user(db_session, email="outra@example.com")
    assert make_bill(client, auth_headers(client, email="outra@example.com"), name="Netflix").status_code == 201


def test_list_is_alphabetical_and_filters(client, headers):
    make_bill(client, headers, name="Spotify")
    netflix = make_bill(client, headers, name="netflix").json()
    make_bill(client, headers, name="Aluguel")
    client.patch(f"{URL}/{netflix['id']}", json={"active": False}, headers=headers)

    assert [b["name"] for b in client.get(URL, headers=headers).json()["items"]] == ["Aluguel", "netflix", "Spotify"]
    assert [b["name"] for b in client.get(URL, params={"q": "FLIX"}, headers=headers).json()["items"]] == ["netflix"]
    assert [b["name"] for b in client.get(URL, params={"active": "true"}, headers=headers).json()["items"]] == [
        "Aluguel",
        "Spotify",
    ]
    assert client.get(URL, params={"q": "%"}, headers=headers).json()["total"] == 0


def test_other_users_bill_is_404(client, headers, db_session):
    bill_id = make_bill(client, headers).json()["id"]
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    for call in (
        client.get(f"{URL}/{bill_id}", headers=other),
        client.patch(f"{URL}/{bill_id}", json={"name": "X"}, headers=other),
        client.delete(f"{URL}/{bill_id}", headers=other),
    ):
        assert call.status_code == 404 and call.json()["code"] == "bill_not_found"
    assert client.get(URL, headers=other).json()["total"] == 0
    assert client.get(f"{URL}/{uuid.uuid4()}", headers=headers).status_code == 404


def test_patch_changes_only_what_was_sent(client, headers):
    bill_id = make_bill(client, headers).json()["id"]
    body = client.patch(
        f"{URL}/{bill_id}", json={"frequency": "yearly", "first_due_date": "2026-06-01"}, headers=headers
    ).json()
    assert body["frequency"] == "yearly" and body["first_due_date"] == "2026-06-01"
    assert body["name"] == "Netflix" and body["amount_min"] == "40.00" and body["match_text"] == "netflix"


def test_patch_null_clears_only_the_match_text(client, headers):
    bill_id = make_bill(client, headers).json()["id"]
    body = client.patch(
        f"{URL}/{bill_id}", json={"match_text": None, "name": None, "amount_min": None, "active": None}, headers=headers
    ).json()
    assert body["match_text"] is None
    assert body["name"] == "Netflix" and body["amount_min"] == "40.00" and body["active"] is True


def test_patch_validates_the_range_against_the_stored_values(client, headers):
    bill_id = make_bill(client, headers).json()["id"]
    # So o maximo, abaixo do minimo que ja existe
    assert client.patch(f"{URL}/{bill_id}", json={"amount_max": "30.00"}, headers=headers).status_code == 422
    assert client.patch(f"{URL}/{bill_id}", json={"amount_min": "70.00"}, headers=headers).status_code == 422
    ok = client.patch(f"{URL}/{bill_id}", json={"amount_min": "20.00", "amount_max": "30.00"}, headers=headers)
    assert ok.status_code == 200 and ok.json()["amount_max"] == "30.00"


def test_patch_cannot_change_the_currency_or_clash_names(client, headers):
    first = make_bill(client, headers, name="A").json()["id"]
    make_bill(client, headers, name="B")
    assert client.patch(f"{URL}/{first}", json={"currency_code": "USD"}, headers=headers).status_code == 422
    clash = client.patch(f"{URL}/{first}", json={"name": "b"}, headers=headers)
    assert clash.status_code == 409 and clash.json()["code"] == "bill_name_taken"


def test_delete_keeps_the_transactions_without_a_bill(client, headers):
    account_id = make_account(client, headers)
    bill = make_bill(client, headers).json()
    tx = spend(client, headers, account_id, bill_id=bill["id"]).json()

    assert client.delete(f"{URL}/{bill['id']}", headers=headers).status_code == 204
    assert client.get(f"{URL}/{bill['id']}", headers=headers).status_code == 404
    assert client.get(f"{TX_URL}/{tx['id']}", headers=headers).json()["splits"][0]["bill_id"] is None


# ---------- Ligar manualmente ----------


def test_a_withdrawal_can_be_linked_by_id_even_outside_the_range_and_text(client, headers):
    account_id = make_account(client, headers)
    bill = make_bill(client, headers).json()
    resp = spend(client, headers, account_id, amount="999.00", description="outra coisa", bill_id=bill["id"])
    assert resp.status_code == 201
    assert bill_id_of(resp) == bill["id"]


def test_bill_of_another_user_or_unknown_is_refused(client, headers, db_session):
    make_user(db_session, email="outra@example.com")
    foreign = make_bill(client, auth_headers(client, email="outra@example.com")).json()["id"]
    account_id = make_account(client, headers)
    for bill_id in (foreign, str(uuid.uuid4())):
        resp = spend(client, headers, account_id, bill_id=bill_id)
        assert resp.status_code == 404 and resp.json()["code"] == "bill_not_found"


def test_only_spending_can_be_linked(client, headers):
    account_id = make_account(client, headers)
    other_id = make_account(client, headers, name="Poupanca")
    debt_id = make_account(client, headers, name="Financ", type="liability", role="mortgage", opening_balance="0")
    bill = make_bill(client, headers).json()["id"]

    deposit = spend(client, headers, account_id, type="deposit", counterparty_name="Empregador", bill_id=bill)
    transfer = spend(
        client, headers, account_id, type="transfer", counterparty_name=None, counterparty_account_id=other_id, bill_id=bill
    )
    debt = spend(client, headers, account_id, counterparty_name=None, counterparty_account_id=debt_id, bill_id=bill)
    for resp in (deposit, transfer, debt):
        assert resp.status_code == 400 and resp.json()["code"] == "bill_not_allowed"


def test_currency_must_match_the_bill(client, headers):
    usd_account = make_account(client, headers, name="Wise", currency_code="USD")
    bill = make_bill(client, headers).json()["id"]
    resp = spend(client, headers, usd_account, currency_code="USD", bill_id=bill)
    assert resp.status_code == 400 and resp.json()["code"] == "currency_mismatch"


def test_explicit_null_blocks_the_automatic_link(client, headers):
    account_id = make_account(client, headers)
    make_bill(client, headers)
    assert bill_id_of(spend(client, headers, account_id, bill_id=None)) is None


# ---------- Ligar sozinho ----------


def test_a_matching_withdrawal_is_linked_automatically(client, headers):
    account_id = make_account(client, headers)
    bill = make_bill(client, headers).json()
    assert bill_id_of(spend(client, headers, account_id)) == bill["id"]


@pytest.mark.parametrize("description", ["NETFLIX.COM", "pagamento netflix mensal", "Netflix"])
def test_the_match_ignores_case_and_finds_the_text_anywhere(client, headers, description):
    account_id = make_account(client, headers)
    bill = make_bill(client, headers).json()
    assert bill_id_of(spend(client, headers, account_id, description=description)) == bill["id"]


def test_the_stored_text_may_be_uppercase_too(client, headers):
    account_id = make_account(client, headers)
    bill = make_bill(client, headers, match_text="NetFlix").json()
    assert bill_id_of(spend(client, headers, account_id, description="assinatura netflix")) == bill["id"]


def test_the_match_also_looks_at_the_counterparty_name(client, headers):
    account_id = make_account(client, headers)
    bill = make_bill(client, headers).json()
    resp = spend(client, headers, account_id, description="Mensalidade", counterparty_name="NETFLIX BRASIL")
    assert bill_id_of(resp) == bill["id"]


def test_value_must_be_inside_the_range_inclusive(client, headers):
    account_id = make_account(client, headers)
    bill = make_bill(client, headers).json()["id"]
    assert bill_id_of(spend(client, headers, account_id, amount="40.00")) == bill
    assert bill_id_of(spend(client, headers, account_id, amount="60.00")) == bill
    assert bill_id_of(spend(client, headers, account_id, amount="39.99")) is None
    assert bill_id_of(spend(client, headers, account_id, amount="60.01")) is None


def test_no_automatic_link_when_the_text_does_not_appear(client, headers):
    account_id = make_account(client, headers)
    make_bill(client, headers)
    assert bill_id_of(spend(client, headers, account_id, description="Spotify")) is None


def test_a_bill_without_match_text_is_never_linked_automatically(client, headers):
    account_id = make_account(client, headers)
    make_bill(client, headers, match_text=None)
    assert bill_id_of(spend(client, headers, account_id)) is None


def test_two_matching_bills_link_nothing(client, headers):
    account_id = make_account(client, headers)
    make_bill(client, headers, name="Netflix 1")
    make_bill(client, headers, name="Netflix 2")
    assert bill_id_of(spend(client, headers, account_id)) is None


def test_archived_bills_and_other_currencies_do_not_match(client, headers):
    account_id = make_account(client, headers)
    usd_account = make_account(client, headers, name="Wise", currency_code="USD")
    bill = make_bill(client, headers).json()["id"]
    client.patch(f"{URL}/{bill}", json={"active": False}, headers=headers)
    assert bill_id_of(spend(client, headers, account_id)) is None

    client.patch(f"{URL}/{bill}", json={"active": True}, headers=headers)
    assert bill_id_of(spend(client, headers, usd_account, currency_code="USD")) is None


def test_other_users_bill_is_never_matched(client, headers, db_session):
    make_user(db_session, email="outra@example.com")
    make_bill(client, auth_headers(client, email="outra@example.com"))
    account_id = make_account(client, headers)
    assert bill_id_of(spend(client, headers, account_id)) is None


def test_only_withdrawals_to_an_expense_are_matched(client, headers):
    account_id = make_account(client, headers)
    debt_id = make_account(client, headers, name="Financ", type="liability", role="mortgage", opening_balance="0")
    make_bill(client, headers, name="Netflix", match_text="netflix")
    deposit = spend(client, headers, account_id, type="deposit", counterparty_name="Netflix reembolso")
    debt = spend(client, headers, account_id, counterparty_name=None, counterparty_account_id=debt_id)
    assert bill_id_of(deposit) is None
    assert bill_id_of(debt) is None


def test_editing_without_bill_id_matches_again_and_with_null_keeps_it_unlinked(client, headers):
    account_id = make_account(client, headers)
    bill = make_bill(client, headers).json()["id"]
    tx = spend(client, headers, account_id, bill_id=None).json()
    assert tx["splits"][0]["bill_id"] is None

    line = {
        "type": "withdrawal",
        "date": "2026-03-06",
        "description": "Assinatura Netflix",
        "amount": "50.00",
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Streaming",
    }
    again = client.put(f"{TX_URL}/{tx['id']}", json={"splits": [line]}, headers=headers).json()
    assert again["splits"][0]["bill_id"] == bill
    kept = client.put(f"{TX_URL}/{tx['id']}", json={"splits": [{**line, "bill_id": None}]}, headers=headers).json()
    assert kept["splits"][0]["bill_id"] is None


def test_each_line_of_a_split_group_is_matched_on_its_own(client, headers):
    account_id = make_account(client, headers)
    bill = make_bill(client, headers).json()["id"]
    line = {"type": "withdrawal", "date": "2026-03-06", "currency_code": "BRL", "account_id": account_id, "counterparty_name": "Loja"}
    resp = client.post(
        TX_URL,
        json={
            "title": "Compras",
            "splits": [
                {**line, "description": "Netflix", "amount": "50.00"},
                {**line, "description": "Mercado", "amount": "50.00"},
            ],
        },
        headers=headers,
    )
    assert [s["bill_id"] for s in resp.json()["splits"]] == [bill, None]


def test_list_transactions_filters_by_bill(client, headers):
    account_id = make_account(client, headers)
    bill = make_bill(client, headers).json()["id"]
    spend(client, headers, account_id, description="Netflix de marco")
    spend(client, headers, account_id, description="Outra coisa", amount="500.00")

    items = client.get(TX_URL, params={"bill_id": bill}, headers=headers).json()["items"]
    assert [i["splits"][0]["description"] for i in items] == ["Netflix de marco"]


# ---------- Situacao dos vencimentos ----------


def test_before_the_first_due_date_the_bill_is_upcoming(client, headers):
    make_bill(client, headers, first_due_date="2026-03-05")
    [item] = status(client, headers, on="2026-03-01").json()
    assert item["status"] == "upcoming"
    assert item["last_due_date"] is None
    assert item["next_due_date"] == "2026-03-05"
    assert item["next_due_paid"] is False


def test_an_unpaid_due_date_that_passed_is_overdue(client, headers):
    make_bill(client, headers)
    [item] = status(client, headers, on="2026-03-10").json()
    assert item["status"] == "overdue"
    assert item["last_due_date"] == "2026-03-05"
    assert item["next_due_date"] == "2026-04-05"


def test_the_due_date_itself_counts_as_due_not_upcoming(client, headers):
    make_bill(client, headers)
    [item] = status(client, headers, on="2026-03-05").json()
    assert item["last_due_date"] == "2026-03-05" and item["status"] == "overdue"


def test_a_linked_payment_marks_the_due_date_as_paid(client, headers):
    account_id = make_account(client, headers)
    make_bill(client, headers)
    spend(client, headers, account_id, on="2026-03-06")
    [item] = status(client, headers, on="2026-03-10").json()
    assert item["status"] == "paid"
    assert item["next_due_paid"] is False


def test_paying_a_few_days_early_counts_for_the_nearest_due_date(client, headers):
    account_id = make_account(client, headers)
    make_bill(client, headers)
    spend(client, headers, account_id, on="2026-03-02")
    [item] = status(client, headers, on="2026-03-10").json()
    assert item["status"] == "paid"


def test_paying_the_next_one_in_advance_marks_next_due_paid(client, headers):
    account_id = make_account(client, headers)
    make_bill(client, headers)
    # 1/4 fica mais perto do vencimento de 5/4 do que do de 5/3
    spend(client, headers, account_id, on="2026-04-01")
    [item] = status(client, headers, on="2026-03-10").json()
    assert item["status"] == "overdue"
    assert item["next_due_paid"] is True


def test_the_midpoint_decides_which_due_date_a_payment_belongs_to(client, headers):
    account_id = make_account(client, headers)
    make_bill(client, headers)
    # Meio entre 5/3 e 5/4 e 20/3: ate esse dia ainda e a conta de marco
    spend(client, headers, account_id, on="2026-03-20")
    assert status(client, headers, on="2026-03-25").json()[0]["status"] == "paid"
    assert status(client, headers, on="2026-03-25").json()[0]["next_due_paid"] is False


def test_a_payment_after_the_midpoint_belongs_to_the_next_due_date(client, headers):
    account_id = make_account(client, headers)
    make_bill(client, headers)
    spend(client, headers, account_id, on="2026-03-21")
    [item] = status(client, headers, on="2026-03-25").json()
    assert item["status"] == "overdue"
    assert item["next_due_paid"] is True


def test_a_payment_of_an_older_month_does_not_pay_the_current_one(client, headers):
    account_id = make_account(client, headers)
    make_bill(client, headers)
    spend(client, headers, account_id, on="2026-03-06")
    [item] = status(client, headers, on="2026-04-10").json()
    assert item["last_due_date"] == "2026-04-05"
    assert item["status"] == "overdue"


def test_unlinked_transactions_do_not_pay_anything(client, headers):
    account_id = make_account(client, headers)
    make_bill(client, headers)
    spend(client, headers, account_id, on="2026-03-06", bill_id=None)
    assert status(client, headers, on="2026-03-10").json()[0]["status"] == "overdue"


def test_one_missed_due_date_is_one_overdue(client, headers):
    make_bill(client, headers)
    [item] = status(client, headers, on="2026-03-10").json()
    assert item["overdue_count"] == 1
    assert item["oldest_overdue_date"] == "2026-03-05"


def test_several_missed_due_dates_in_a_row_are_counted_with_the_oldest_date(client, headers):
    make_bill(client, headers)
    [item] = status(client, headers, on="2026-05-10").json()
    assert item["last_due_date"] == "2026-05-05"
    assert item["overdue_count"] == 3
    assert item["oldest_overdue_date"] == "2026-03-05"


def test_the_count_stops_at_the_last_paid_due_date(client, headers):
    account_id = make_account(client, headers)
    make_bill(client, headers)
    spend(client, headers, account_id, on="2026-03-06")
    [item] = status(client, headers, on="2026-05-10").json()
    assert item["overdue_count"] == 2
    assert item["oldest_overdue_date"] == "2026-04-05"


def test_an_older_unpaid_due_date_before_a_paid_one_is_not_counted(client, headers):
    account_id = make_account(client, headers)
    make_bill(client, headers)
    spend(client, headers, account_id, on="2026-04-06")
    [item] = status(client, headers, on="2026-05-10").json()
    assert item["overdue_count"] == 1
    assert item["oldest_overdue_date"] == "2026-05-05"


def test_a_paid_bill_has_no_overdue_run(client, headers):
    account_id = make_account(client, headers)
    make_bill(client, headers)
    spend(client, headers, account_id, on="2026-03-06")
    [item] = status(client, headers, on="2026-03-10").json()
    assert item["status"] == "paid"
    assert item["overdue_count"] == 0 and item["oldest_overdue_date"] is None


def test_an_upcoming_bill_has_no_overdue_run(client, headers):
    make_bill(client, headers, first_due_date="2026-09-05")
    [item] = status(client, headers, on="2026-03-10").json()
    assert item["overdue_count"] == 0 and item["oldest_overdue_date"] is None


def test_status_is_sorted_by_next_due_date(client, headers):
    # Nomes em ordem alfabetica contraria a dos vencimentos: so a ordenacao por data acerta
    make_bill(client, headers, name="A tarde", first_due_date="2026-03-25")
    make_bill(client, headers, name="B cedo", first_due_date="2026-03-12")
    make_bill(client, headers, name="C meio", first_due_date="2026-03-18")
    assert [i["name"] for i in status(client, headers, on="2026-03-10").json()] == ["B cedo", "C meio", "A tarde"]


def test_status_hides_archived_unless_asked(client, headers):
    make_bill(client, headers, name="Ativa")
    old = make_bill(client, headers, name="Velha").json()["id"]
    client.patch(f"{URL}/{old}", json={"active": False}, headers=headers)
    assert [i["name"] for i in status(client, headers, on="2026-03-10").json()] == ["Ativa"]
    assert len(status(client, headers, on="2026-03-10", include_archived="true").json()) == 2


def test_status_is_empty_without_bills_and_defaults_to_today(client, headers):
    assert status(client, headers).json() == []
    make_bill(client, headers, first_due_date="2020-01-15")
    [item] = status(client, headers).json()
    assert item["last_due_date"] <= item["next_due_date"]


def test_status_does_not_mix_users(client, headers, db_session):
    make_bill(client, headers)
    make_user(db_session, email="outra@example.com")
    assert status(client, auth_headers(client, email="outra@example.com"), on="2026-03-10").json() == []


def test_status_formats_money_with_the_currency_places(client, headers):
    make_bill(client, headers, currency_code="JPY", amount_min="1000", amount_max="1500")
    [item] = status(client, headers, on="2026-03-10").json()
    assert (item["amount_min"], item["amount_max"]) == ("1000", "1500")


def test_status_uses_a_fixed_number_of_queries(client, headers, db_session):
    from sqlalchemy import event

    from app.core.database import engine

    account_id = make_account(client, headers)
    for index in range(6):
        make_bill(client, headers, name=f"Conta {index}", match_text=f"conta{index}")
        spend(client, headers, account_id, description=f"conta{index}", on="2026-03-06")

    statements: list[str] = []

    def count(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        assert len(status(client, headers, on="2026-03-10").json()) == 6
    finally:
        event.remove(engine, "before_cursor_execute", count)

    # Autenticacao, contas, pagamentos e moedas
    assert len(statements) <= 6, statements
