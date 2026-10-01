"""Regras de dinheiro, moeda e consulta das transacoes que os testes basicos nao cobrem."""

import uuid

import pytest
from sqlalchemy import event

from app.core.database import engine
from app.models.account import Account, AccountType
from app.models.transaction import Transaction, TransactionSplit, TransactionType
from tests.conftest import auth_headers, make_user, register
from tests.test_transactions import ACCOUNTS_URL, URL, balance_of, make_account, withdrawal


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def deposit(account_id, **overrides):
    return {
        "type": "deposit",
        "date": "2026-02-01",
        "description": "Salario",
        "amount": "300.00",
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Empregador",
        **overrides,
    }


def transfer(source_id, destination_id, **overrides):
    return {
        "type": "transfer",
        "date": "2026-02-01",
        "description": "Transferencia",
        "amount": "100.00",
        "currency_code": "BRL",
        "account_id": source_id,
        "counterparty_account_id": destination_id,
        **overrides,
    }


def post(client, headers, *splits, **extra):
    return client.post(URL, json={"splits": list(splits), **extra}, headers=headers)


def count_withdrawals(db_session) -> int:
    return db_session.query(TransactionSplit).filter(TransactionSplit.type == TransactionType.withdrawal).count()


def count_accounts(db_session, account_type) -> int:
    return db_session.query(Account).filter(Account.type == account_type).count()


# ---------- A moeda do lancamento tem que ser a da conta ----------


def test_withdrawal_in_another_currency_than_the_account_is_rejected(client, headers, db_session):
    account_id = make_account(client, headers)  # BRL
    resp = post(client, headers, withdrawal(account_id, currency_code="USD"))
    assert resp.status_code == 400
    assert resp.json()["code"] == "currency_mismatch"
    # Nada ficou para tras: nem o lancamento, nem a contraparte, e o saldo nao mexeu
    assert count_withdrawals(db_session) == 0
    assert count_accounts(db_session, AccountType.expense) == 0
    assert balance_of(client, headers, account_id) == "1000.00"


def test_deposit_in_another_currency_than_the_account_is_rejected(client, headers):
    account_id = make_account(client, headers)
    resp = post(client, headers, deposit(account_id, currency_code="USD"))
    assert resp.status_code == 400
    assert resp.json()["code"] == "currency_mismatch"
    assert balance_of(client, headers, account_id) == "1000.00"


def test_transfer_in_another_currency_than_the_source_account_is_rejected(client, headers):
    first = make_account(client, headers, name="A")
    second = make_account(client, headers, name="B", opening_balance="0")
    resp = post(client, headers, transfer(first, second, currency_code="USD"))
    assert resp.status_code == 400
    assert resp.json()["code"] == "currency_mismatch"


# ---------- Transferencia entre moedas diferentes ----------


def test_cross_currency_transfer_credits_the_destination_in_its_own_currency(client, headers):
    brl = make_account(client, headers, name="Real")
    usd = make_account(client, headers, name="Dolar", currency_code="USD", opening_balance="0")
    resp = post(client, headers, transfer(brl, usd, amount="500.00", foreign_amount="100.00", foreign_currency_code="USD"))
    assert resp.status_code == 201
    assert balance_of(client, headers, brl) == "500.00"
    # Entram 100 dolares, nao 500
    assert balance_of(client, headers, usd) == "100.00"


def test_cross_currency_transfer_without_the_destination_amount_is_rejected(client, headers):
    brl = make_account(client, headers, name="Real")
    usd = make_account(client, headers, name="Dolar", currency_code="USD", opening_balance="0")
    resp = post(client, headers, transfer(brl, usd, amount="500.00"))
    assert resp.status_code == 400
    assert resp.json()["code"] == "currency_mismatch"
    assert balance_of(client, headers, usd) == "0.00"


def test_cross_currency_transfer_with_the_wrong_foreign_currency_is_rejected(client, headers):
    brl = make_account(client, headers, name="Real")
    usd = make_account(client, headers, name="Dolar", currency_code="USD", opening_balance="0")
    resp = post(client, headers, transfer(brl, usd, amount="500.00", foreign_amount="90.00", foreign_currency_code="EUR"))
    assert resp.status_code == 400
    assert resp.json()["code"] == "currency_mismatch"


def test_same_currency_transfer_does_not_accept_a_foreign_amount(client, headers):
    first = make_account(client, headers, name="A")
    second = make_account(client, headers, name="B", opening_balance="0")
    resp = post(client, headers, transfer(first, second, foreign_amount="20.00", foreign_currency_code="USD"))
    assert resp.status_code == 400
    assert resp.json()["code"] == "currency_mismatch"


def test_editing_and_deleting_a_cross_currency_transfer_keeps_both_balances_right(client, headers):
    brl = make_account(client, headers, name="Real")
    usd = make_account(client, headers, name="Dolar", currency_code="USD", opening_balance="0")
    created = post(
        client, headers, transfer(brl, usd, amount="500.00", foreign_amount="100.00", foreign_currency_code="USD")
    ).json()

    updated = client.put(
        f"{URL}/{created['id']}",
        json={"splits": [transfer(brl, usd, amount="300.00", foreign_amount="60.00", foreign_currency_code="USD")]},
        headers=headers,
    )
    assert updated.status_code == 200
    assert balance_of(client, headers, brl) == "700.00"
    assert balance_of(client, headers, usd) == "60.00"

    assert client.delete(f"{URL}/{created['id']}", headers=headers).status_code == 204
    assert balance_of(client, headers, brl) == "1000.00"
    assert balance_of(client, headers, usd) == "0.00"


# ---------- Moeda estrangeira so informativa (compra em outra moeda, paga na moeda da conta) ----------


def test_foreign_amount_on_a_withdrawal_does_not_change_the_balance_math(client, headers):
    account_id = make_account(client, headers)
    resp = post(client, headers, withdrawal(account_id, amount="50.00", foreign_amount="10.00", foreign_currency_code="USD"))
    assert resp.status_code == 201
    assert balance_of(client, headers, account_id) == "950.00"


def test_foreign_amount_on_a_deposit_does_not_change_the_balance_math(client, headers):
    account_id = make_account(client, headers)
    resp = post(client, headers, deposit(account_id, amount="300.00", foreign_amount="60.00", foreign_currency_code="USD"))
    assert resp.status_code == 201
    assert balance_of(client, headers, account_id) == "1300.00"


# ---------- Pagar uma divida ----------


def test_paying_a_debt_reduces_what_is_owed(client, headers):
    account_id = make_account(client, headers)
    debt = make_account(client, headers, name="Financiamento", type="liability", opening_balance="500.00")
    assert balance_of(client, headers, debt) == "-500.00"

    resp = post(
        client,
        headers,
        withdrawal(account_id, amount="100.00", counterparty_account_id=debt, counterparty_name=None),
    )
    assert resp.status_code == 201
    assert balance_of(client, headers, account_id) == "900.00"
    assert balance_of(client, headers, debt) == "-400.00"


def test_paying_a_debt_in_another_currency_uses_the_foreign_amount(client, headers):
    account_id = make_account(client, headers)  # BRL
    debt = make_account(
        client, headers, name="Divida em dolar", type="liability", currency_code="USD", opening_balance="200.00"
    )
    resp = post(
        client,
        headers,
        withdrawal(
            account_id,
            amount="100.00",
            foreign_amount="20.00",
            foreign_currency_code="USD",
            counterparty_account_id=debt,
            counterparty_name=None,
        ),
    )
    assert resp.status_code == 201
    assert balance_of(client, headers, account_id) == "900.00"
    assert balance_of(client, headers, debt) == "-180.00"


# ---------- A contraparte tem que ser do tipo certo ----------


def test_withdrawal_to_a_revenue_account_is_rejected(client, headers):
    account_id = make_account(client, headers)
    revenue = post(client, headers, deposit(account_id)).json()["splits"][0]["source_account_id"]
    resp = post(client, headers, withdrawal(account_id, counterparty_account_id=revenue, counterparty_name=None))
    assert resp.status_code == 400
    assert resp.json()["code"] == "invalid_split_accounts"


def test_deposit_from_an_expense_account_is_rejected(client, headers):
    account_id = make_account(client, headers)
    expense = post(client, headers, withdrawal(account_id)).json()["splits"][0]["destination_account_id"]
    resp = post(client, headers, deposit(account_id, counterparty_account_id=expense, counterparty_name=None))
    assert resp.status_code == 400
    assert resp.json()["code"] == "invalid_split_accounts"


def test_withdrawal_to_another_asset_account_must_be_a_transfer(client, headers):
    first = make_account(client, headers, name="A")
    second = make_account(client, headers, name="B", opening_balance="0")
    resp = post(client, headers, withdrawal(first, counterparty_account_id=second, counterparty_name=None))
    assert resp.status_code == 400
    assert resp.json()["code"] == "invalid_split_accounts"


def test_an_existing_expense_account_can_be_reused_by_id(client, headers, db_session):
    account_id = make_account(client, headers)
    expense = post(client, headers, withdrawal(account_id)).json()["splits"][0]["destination_account_id"]
    resp = post(client, headers, withdrawal(account_id, counterparty_account_id=expense, counterparty_name=None))
    assert resp.status_code == 201
    assert count_accounts(db_session, AccountType.expense) == 1


def test_system_accounts_cannot_be_used_as_counterparty(client, headers, db_session):
    account_id = make_account(client, headers)
    system = db_session.query(Account).filter(Account.type == AccountType.initial_balance).first()
    resp = post(client, headers, withdrawal(account_id, counterparty_account_id=str(system.id), counterparty_name=None))
    assert resp.status_code == 404


# ---------- Valores ----------


@pytest.mark.parametrize("amount", ["0", "0.00", "-5.00"])
def test_amount_must_be_positive(client, headers, amount):
    account_id = make_account(client, headers)
    resp = post(client, headers, withdrawal(account_id, amount=amount))
    assert resp.status_code == 422
    assert resp.json()["code"] == "validation_error"


def test_foreign_amount_must_be_positive(client, headers):
    account_id = make_account(client, headers)
    resp = post(client, headers, withdrawal(account_id, foreign_amount="0", foreign_currency_code="USD"))
    assert resp.status_code == 422


def test_yen_amounts_come_back_without_decimals(client, headers):
    account_id = make_account(client, headers, name="Toquio", currency_code="JPY", opening_balance="1000")
    created = post(client, headers, withdrawal(account_id, currency_code="JPY", amount="100")).json()
    assert created["splits"][0]["amount"] == "100"
    assert client.get(f"{URL}/{created['id']}", headers=headers).json()["splits"][0]["amount"] == "100"
    assert client.get(URL, headers=headers).json()["items"][0]["splits"][0]["amount"] == "100"
    assert balance_of(client, headers, account_id) == "900"


# ---------- Tudo ou nada ----------


def test_a_failed_create_leaves_nothing_behind(client, headers, db_session):
    account_id = make_account(client, headers)
    groups_before = db_session.query(Transaction).count()
    resp = post(
        client,
        headers,
        withdrawal(account_id, counterparty_name="Padaria"),
        withdrawal(account_id, category_id=str(uuid.uuid4())),
    )
    assert resp.status_code == 404
    db_session.expire_all()
    assert db_session.query(Transaction).count() == groups_before
    assert count_withdrawals(db_session) == 0
    assert count_accounts(db_session, AccountType.expense) == 0
    assert balance_of(client, headers, account_id) == "1000.00"


def test_a_failed_update_keeps_the_old_splits(client, headers):
    account_id = make_account(client, headers)
    created = post(client, headers, withdrawal(account_id, amount="50.00")).json()
    old_split_ids = [s["id"] for s in created["splits"]]

    resp = client.put(
        f"{URL}/{created['id']}",
        json={"splits": [withdrawal(account_id, amount="10.00"), withdrawal(account_id, category_id=str(uuid.uuid4()))]},
        headers=headers,
    )
    assert resp.status_code == 404

    after = client.get(f"{URL}/{created['id']}", headers=headers).json()
    assert [s["id"] for s in after["splits"]] == old_split_ids
    assert after["splits"][0]["amount"] == "50.00"
    assert balance_of(client, headers, account_id) == "950.00"


# ---------- Filtros e ordem da lista ----------


@pytest.fixture
def three_transactions(client, headers):
    account_id = make_account(client, headers)
    other_id = make_account(client, headers, name="Outra", opening_balance="0")
    ids = {}
    ids["rent"] = post(
        client,
        headers,
        withdrawal(account_id, date="2026-01-10", description="Aluguel de janeiro", amount="400.00", counterparty_name="Imobiliaria"),
    ).json()["id"]
    ids["market"] = post(
        client,
        headers,
        withdrawal(account_id, date="2026-02-15", description="Compra no Mercado", amount="80.00"),
        title="Compras da semana",
    ).json()["id"]
    ids["pay"] = post(client, headers, deposit(other_id, date="2026-03-01", description="Pagamento recebido", amount="900.00")).json()["id"]
    return {"account": account_id, "other": other_id, **ids}


def listed(client, headers, query=""):
    page = client.get(f"{URL}?{query}", headers=headers).json()
    return page, [item["id"] for item in page["items"]]


def test_list_is_ordered_by_the_transaction_date_not_by_when_it_was_typed(client, headers, three_transactions):
    # "rent" foi lancado primeiro, mas e a mais antiga: vem por ultimo
    _, ids = listed(client, headers)
    assert ids == [three_transactions["pay"], three_transactions["market"], three_transactions["rent"]]


def test_a_backdated_transaction_typed_later_still_goes_to_its_place_in_the_list(client, headers):
    """Quem lanca hoje uma compra de janeiro nao pode ve-la no topo: a ordem e pela data dela."""
    account_id = make_account(client, headers)
    recent = post(client, headers, withdrawal(account_id, date="2026-05-01", description="Recente")).json()["id"]
    old = post(client, headers, withdrawal(account_id, date="2026-01-01", description="Antiga")).json()["id"]
    _, ids = listed(client, headers)
    assert ids == [recent, old]


def test_same_day_transactions_keep_a_stable_order_across_pages(client, headers):
    account_id = make_account(client, headers)
    for index in range(5):
        post(client, headers, withdrawal(account_id, date="2026-02-01", description=f"Compra {index}"))
    seen = []
    for offset in (0, 2, 4):
        seen += listed(client, headers, f"limit=2&offset={offset}")[1]
    assert len(seen) == 5
    assert len(set(seen)) == 5


def test_filter_by_date_range(client, headers, three_transactions):
    _, ids = listed(client, headers, "date_from=2026-02-01&date_to=2026-02-28")
    assert ids == [three_transactions["market"]]
    _, ids = listed(client, headers, "date_from=2026-02-15")
    assert ids == [three_transactions["pay"], three_transactions["market"]]
    _, ids = listed(client, headers, "date_to=2026-01-31")
    assert ids == [three_transactions["rent"]]


def test_filter_by_text_in_description_or_title_ignoring_case(client, headers, three_transactions):
    _, ids = listed(client, headers, "q=ALUGUEL")
    assert ids == [three_transactions["rent"]]
    _, ids = listed(client, headers, "q=compras da semana")
    assert ids == [three_transactions["market"]]
    _, ids = listed(client, headers, "q=zzz")
    assert ids == []


def test_percent_in_the_text_filter_is_plain_text(client, headers, three_transactions):
    page, ids = listed(client, headers, "q=%25")
    assert ids == []
    assert page["total"] == 0


def test_filter_by_amount_range(client, headers, three_transactions):
    _, ids = listed(client, headers, "min_amount=100")
    assert ids == [three_transactions["pay"], three_transactions["rent"]]
    _, ids = listed(client, headers, "max_amount=100")
    assert ids == [three_transactions["market"]]
    _, ids = listed(client, headers, "min_amount=80&max_amount=80")
    assert ids == [three_transactions["market"]]


def test_filters_combine(client, headers, three_transactions):
    _, ids = listed(client, headers, f"account_id={three_transactions['account']}&date_from=2026-02-01")
    assert ids == [three_transactions["market"]]
    _, ids = listed(client, headers, f"account_id={three_transactions['other']}&q=aluguel")
    assert ids == []


def test_filtered_total_matches_the_filter_not_the_page(client, headers, three_transactions):
    page, ids = listed(client, headers, "limit=1&date_from=2026-01-01")
    assert page["total"] == 3
    assert len(ids) == 1


@pytest.mark.parametrize("query", ["date_from=ontem", "min_amount=abc", "min_amount=1.234", "account_id=nao-e-uuid"])
def test_invalid_filters_are_rejected(client, headers, query):
    assert client.get(f"{URL}?{query}", headers=headers).status_code == 422


def test_filters_never_cross_users(client, headers, three_transactions, db_session):
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    page, ids = listed(client, other, "q=aluguel")
    assert ids == []
    assert page["total"] == 0


# ---------- Desempenho: o numero de consultas nao cresce com a pagina ----------


def count_queries(action) -> int:
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        action()
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return len(statements)


def test_listing_does_not_run_a_query_per_transaction(client, headers):
    account_id = make_account(client, headers)
    post(client, headers, withdrawal(account_id, description="Primeira"))
    few = count_queries(lambda: client.get(URL, headers=headers))

    for index in range(12):
        post(client, headers, withdrawal(account_id, description=f"Compra {index}", counterparty_name=f"Loja {index}"))
    many = count_queries(lambda: client.get(URL, headers=headers))

    assert client.get(URL, headers=headers).json()["total"] == 13
    assert many == few
