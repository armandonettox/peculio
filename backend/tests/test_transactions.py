import uuid
from datetime import date

import pytest
from sqlalchemy import select

from app.models.account import Account, AccountType
from app.models.category import Category
from app.models.tag import Tag
from app.models.transaction import Transaction, TransactionSplit, transaction_split_tags
from tests.conftest import auth_headers, make_user, register

URL = "/api/v1/transactions"
ACCOUNTS_URL = "/api/v1/accounts"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_account(client, headers, **overrides):
    body = {"name": "Nubank", "type": "asset", "currency_code": "BRL", "opening_balance": "1000.00", **overrides}
    return client.post(ACCOUNTS_URL, json=body, headers=headers).json()["id"]


def withdrawal(account_id, **overrides):
    return {
        "type": "withdrawal",
        "date": "2026-02-01",
        "description": "Compra no mercado",
        "amount": "50.00",
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Supermercado",
        **overrides,
    }


def other_user_headers(client, db_session, email="outra@example.com"):
    make_user(db_session, email=email)
    return auth_headers(client, email=email)


def balance_of(client, headers, account_id):
    return client.get(f"{ACCOUNTS_URL}/{account_id}", headers=headers).json()["balance"]


# ---------- Criar: saque, deposito, transferencia ----------


def test_requires_login(client):
    assert client.get(URL).status_code == 401
    assert client.post(URL, json={}).status_code == 401


def test_withdrawal_creates_counterparty_expense_account(client, headers, db_session):
    account_id = make_account(client, headers)
    resp = client.post(URL, json={"splits": [withdrawal(account_id)]}, headers=headers)
    assert resp.status_code == 201
    body = resp.json()
    assert len(body["splits"]) == 1
    split = body["splits"][0]
    assert split["type"] == "withdrawal"
    assert split["amount"] == "50.00"
    assert split["source_account_id"] == account_id

    counterparty = db_session.get(Account, uuid.UUID(split["destination_account_id"]))
    assert counterparty.type == AccountType.expense
    assert counterparty.name == "Supermercado"
    assert balance_of(client, headers, account_id) == "950.00"


def test_second_withdrawal_to_the_same_counterparty_reuses_the_account(client, headers, db_session):
    account_id = make_account(client, headers)
    client.post(URL, json={"splits": [withdrawal(account_id)]}, headers=headers)
    client.post(URL, json={"splits": [withdrawal(account_id, description="Outra compra")]}, headers=headers)
    expenses = db_session.query(Account).filter(Account.type == AccountType.expense).all()
    assert len(expenses) == 1


def test_deposit_creates_counterparty_revenue_account(client, headers, db_session):
    account_id = make_account(client, headers)
    body = {
        "splits": [
            {
                "type": "deposit",
                "date": "2026-02-01",
                "description": "Salario",
                "amount": "3000.00",
                "currency_code": "BRL",
                "account_id": account_id,
                "counterparty_name": "Empregador",
            }
        ]
    }
    resp = client.post(URL, json=body, headers=headers)
    assert resp.status_code == 201
    split = resp.json()["splits"][0]
    assert split["destination_account_id"] == account_id
    counterparty = db_session.get(Account, uuid.UUID(split["source_account_id"]))
    assert counterparty.type == AccountType.revenue
    assert balance_of(client, headers, account_id) == "4000.00"


def test_transfer_between_two_owned_accounts(client, headers):
    first = make_account(client, headers, name="Conta A")
    second = make_account(client, headers, name="Conta B", opening_balance="0")
    body = {
        "splits": [
            {
                "type": "transfer",
                "date": "2026-02-01",
                "description": "Transferencia entre contas",
                "amount": "100.00",
                "currency_code": "BRL",
                "account_id": first,
                "counterparty_account_id": second,
            }
        ]
    }
    resp = client.post(URL, json=body, headers=headers)
    assert resp.status_code == 201
    assert balance_of(client, headers, first) == "900.00"
    assert balance_of(client, headers, second) == "100.00"


def test_transfer_requires_an_existing_account_not_a_name(client, headers):
    account_id = make_account(client, headers)
    body = {
        "splits": [
            {
                "type": "transfer",
                "date": "2026-02-01",
                "description": "x",
                "amount": "10.00",
                "currency_code": "BRL",
                "account_id": account_id,
                "counterparty_name": "Outra conta",
            }
        ]
    }
    assert client.post(URL, json=body, headers=headers).status_code == 422


def test_transfer_to_itself_is_rejected(client, headers):
    account_id = make_account(client, headers)
    body = {
        "splits": [
            {
                "type": "transfer",
                "date": "2026-02-01",
                "description": "x",
                "amount": "10.00",
                "currency_code": "BRL",
                "account_id": account_id,
                "counterparty_account_id": account_id,
            }
        ]
    }
    resp = client.post(URL, json=body, headers=headers)
    assert resp.status_code == 400
    assert resp.json()["code"] == "invalid_split_accounts"


def test_withdrawal_with_both_counterparty_fields_is_rejected(client, headers):
    account_id = make_account(client, headers)
    resp = client.post(
        URL,
        json={"splits": [withdrawal(account_id, counterparty_account_id=str(uuid.uuid4()))]},
        headers=headers,
    )
    assert resp.status_code == 422


def test_withdrawal_without_any_counterparty_is_rejected(client, headers):
    account_id = make_account(client, headers)
    split = withdrawal(account_id)
    split.pop("counterparty_name")
    resp = client.post(URL, json={"splits": [split]}, headers=headers)
    assert resp.status_code == 422


# ---------- Divisao em varias categorias (splits) ----------


def make_category(client, headers, name="Mercado", kind="expense"):
    return client.post("/api/v1/categories", json={"name": name, "kind": kind}, headers=headers).json()["id"]


def test_split_transaction_with_two_categories(client, headers):
    account_id = make_account(client, headers)
    food = make_category(client, headers, "Comida")
    hygiene = make_category(client, headers, "Higiene")
    body = {
        "title": "Compra no mercado",
        "splits": [
            withdrawal(account_id, description="Comida", amount="70.00", category_id=food),
            withdrawal(account_id, description="Higiene", amount="30.00", category_id=hygiene),
        ],
    }
    resp = client.post(URL, json=body, headers=headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body["title"] == "Compra no mercado"
    assert len(body["splits"]) == 2
    assert {s["category_id"] for s in body["splits"]} == {food, hygiene}
    assert balance_of(client, headers, account_id) == "900.00"


def test_unknown_category_is_rejected(client, headers):
    account_id = make_account(client, headers)
    resp = client.post(
        URL, json={"splits": [withdrawal(account_id, category_id=str(uuid.uuid4()))]}, headers=headers
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "category_not_found"


def test_tags_are_attached_to_the_split(client, headers, db_session):
    account_id = make_account(client, headers)
    tag_a = client.post("/api/v1/tags", json={"name": "viagem"}, headers=headers).json()["id"]
    tag_b = client.post("/api/v1/tags", json={"name": "trabalho"}, headers=headers).json()["id"]
    resp = client.post(URL, json={"splits": [withdrawal(account_id, tag_ids=[tag_a, tag_b])]}, headers=headers)
    split = resp.json()["splits"][0]
    assert sorted(split["tag_ids"]) == sorted([tag_a, tag_b])


def test_unknown_tag_is_rejected(client, headers):
    account_id = make_account(client, headers)
    resp = client.post(URL, json={"splits": [withdrawal(account_id, tag_ids=[str(uuid.uuid4())])]}, headers=headers)
    assert resp.status_code == 404
    assert resp.json()["code"] == "tag_not_found"


# ---------- Multimoeda ----------


def test_foreign_amount_and_currency(client, headers):
    account_id = make_account(client, headers, currency_code="USD", opening_balance="500.00")
    resp = client.post(
        URL,
        json={
            "splits": [
                withdrawal(
                    account_id,
                    currency_code="USD",
                    amount="20.00",
                    foreign_amount="100.00",
                    foreign_currency_code="BRL",
                )
            ]
        },
        headers=headers,
    )
    assert resp.status_code == 201
    split = resp.json()["splits"][0]
    assert split["foreign_amount"] == "100.00"
    assert split["foreign_currency_code"] == "BRL"


def test_foreign_amount_without_currency_is_rejected(client, headers):
    account_id = make_account(client, headers)
    resp = client.post(URL, json={"splits": [withdrawal(account_id, foreign_amount="10.00")]}, headers=headers)
    assert resp.status_code == 422


def test_yen_has_no_decimals(client, headers):
    account_id = make_account(client, headers, currency_code="JPY", opening_balance="1000")
    resp = client.post(
        URL, json={"splits": [withdrawal(account_id, currency_code="JPY", amount="10.50")]}, headers=headers
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "invalid_amount"


# ---------- Listar e ler ----------


def test_list_and_get(client, headers):
    account_id = make_account(client, headers)
    created = client.post(URL, json={"splits": [withdrawal(account_id)]}, headers=headers).json()
    page = client.get(URL, headers=headers).json()
    assert page["total"] == 1
    assert page["items"][0]["id"] == created["id"]

    resp = client.get(f"{URL}/{created['id']}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == created["id"]


def test_unknown_transaction_is_404(client, headers):
    resp = client.get(f"{URL}/{uuid.uuid4()}", headers=headers)
    assert resp.status_code == 404
    assert resp.json()["code"] == "transaction_not_found"


def test_filter_by_account_category_and_tag(client, headers):
    account_id = make_account(client, headers)
    other_account = make_account(client, headers, name="Outra")
    category_id = make_category(client, headers)
    tag_id = client.post("/api/v1/tags", json={"name": "fixo"}, headers=headers).json()["id"]

    match = client.post(
        URL,
        json={"splits": [withdrawal(account_id, category_id=category_id, tag_ids=[tag_id])]},
        headers=headers,
    ).json()
    client.post(URL, json={"splits": [withdrawal(other_account)]}, headers=headers)

    assert [t["id"] for t in client.get(f"{URL}?account_id={account_id}", headers=headers).json()["items"]] == [
        match["id"]
    ]
    assert [t["id"] for t in client.get(f"{URL}?category_id={category_id}", headers=headers).json()["items"]] == [
        match["id"]
    ]
    assert [t["id"] for t in client.get(f"{URL}?tag_id={tag_id}", headers=headers).json()["items"]] == [match["id"]]


def test_filter_by_uncategorized(client, headers):
    account_id = make_account(client, headers)
    category_id = make_category(client, headers)

    with_category = client.post(
        URL, json={"splits": [withdrawal(account_id, category_id=category_id)]}, headers=headers
    ).json()
    without_category = client.post(URL, json={"splits": [withdrawal(account_id)]}, headers=headers).json()

    items = client.get(f"{URL}?uncategorized=true", headers=headers).json()["items"]
    assert [t["id"] for t in items] == [without_category["id"]]
    assert with_category["id"] not in [t["id"] for t in items]

    # category_id e uncategorized juntos nao combinam: nenhum grupo atende aos dois ao mesmo tempo
    items = client.get(f"{URL}?uncategorized=true&category_id={category_id}", headers=headers).json()["items"]
    assert items == []


# ---------- Isolamento entre usuarios ----------


def test_users_only_see_their_own_transactions(client, headers, db_session):
    account_id = make_account(client, headers)
    client.post(URL, json={"splits": [withdrawal(account_id)]}, headers=headers)

    other = other_user_headers(client, db_session)
    other_account = make_account(client, other)
    client.post(URL, json={"splits": [withdrawal(other_account)]}, headers=other)

    assert client.get(URL, headers=headers).json()["total"] == 1
    assert client.get(URL, headers=other).json()["total"] == 1


def test_cannot_use_another_users_account(client, headers, db_session):
    other = other_user_headers(client, db_session)
    other_account = make_account(client, other)
    resp = client.post(URL, json={"splits": [withdrawal(other_account)]}, headers=headers)
    assert resp.status_code == 404


def test_another_users_transaction_is_404(client, headers, db_session):
    account_id = make_account(client, headers)
    created = client.post(URL, json={"splits": [withdrawal(account_id)]}, headers=headers).json()
    other = other_user_headers(client, db_session)

    assert client.get(f"{URL}/{created['id']}", headers=other).status_code == 404
    assert client.delete(f"{URL}/{created['id']}", headers=other).status_code == 404


# ---------- Editar e excluir ----------


def test_update_replaces_the_splits(client, headers):
    account_id = make_account(client, headers)
    created = client.post(URL, json={"splits": [withdrawal(account_id, amount="50.00")]}, headers=headers).json()

    resp = client.put(
        f"{URL}/{created['id']}",
        json={"title": "Editado", "splits": [withdrawal(account_id, amount="80.00")]},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Editado"
    assert len(body["splits"]) == 1
    assert body["splits"][0]["amount"] == "80.00"
    assert balance_of(client, headers, account_id) == "920.00"


def test_delete_transaction_removes_its_splits(client, headers, db_session):
    account_id = make_account(client, headers)
    created = client.post(URL, json={"splits": [withdrawal(account_id)]}, headers=headers).json()

    resp = client.delete(f"{URL}/{created['id']}", headers=headers)
    assert resp.status_code == 204
    assert client.get(f"{URL}/{created['id']}", headers=headers).status_code == 404
    assert db_session.query(TransactionSplit).filter(TransactionSplit.transaction_id == uuid.UUID(created["id"])).count() == 0
    assert balance_of(client, headers, account_id) == "1000.00"
