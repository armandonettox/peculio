import uuid
from datetime import date

import pytest
from sqlalchemy import select

from app.models.account import Account, AccountType
from app.models.transaction import Transaction, TransactionSplit, TransactionType
from tests.conftest import auth_headers, make_user, register

URL = "/api/v1/accounts"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make(client, headers, **overrides):
    body = {"name": "Nubank", "type": "asset", "currency_code": "BRL", **overrides}
    return client.post(URL, json=body, headers=headers)


def other_user_headers(client, db_session, email="outra@example.com"):
    make_user(db_session, email=email)
    return auth_headers(client, email=email)


# ---------- Criar ----------


def test_requires_login(client):
    assert client.get(URL).status_code == 401
    assert client.post(URL, json={}).status_code == 401


def test_create_asset_with_opening_balance(client, headers):
    resp = make(client, headers, opening_balance="3200.50", opening_balance_date="2026-01-15")
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Nubank"
    assert body["type"] == "asset"
    assert body["role"] == "checking"
    assert body["balance"] == "3200.50"
    assert body["opening_balance"] == "3200.50"
    assert body["opening_balance_date"] == "2026-01-15"
    assert body["active"] is True


def test_money_is_returned_as_text_never_as_number(client, headers):
    body = make(client, headers, opening_balance="10.10").json()
    assert isinstance(body["balance"], str)
    assert isinstance(body["opening_balance"], str)


def test_create_without_opening_balance_has_zero_balance_and_no_transaction(client, headers, db_session):
    body = make(client, headers).json()
    assert body["balance"] == "0.00"
    assert body["opening_balance"] == "0.00"
    assert body["opening_balance_date"] is None
    assert db_session.query(TransactionSplit).count() == 0


def test_opening_balance_is_stored_as_a_special_transaction(client, headers, db_session):
    account_id = make(client, headers, opening_balance="100.00", opening_balance_date="2026-02-01").json()["id"]

    split = db_session.execute(select(TransactionSplit)).scalar_one()
    assert split.type == TransactionType.opening_balance
    assert str(split.destination_account_id) == account_id
    assert split.amount == 100
    assert split.date == date(2026, 2, 1)
    source = db_session.get(Account, split.source_account_id)
    assert source.type == AccountType.initial_balance
    assert source.name == "Saldo inicial (BRL)"


def test_negative_opening_balance_on_asset_is_allowed(client, headers):
    body = make(client, headers, opening_balance="-100.00").json()
    assert body["balance"] == "-100.00"
    assert body["opening_balance"] == "-100.00"


def test_liability_opening_is_the_amount_owed_and_balance_is_negative(client, headers):
    resp = make(client, headers, name="Financiamento", type="liability", role="mortgage", opening_balance="5000.00")
    body = resp.json()
    assert body["type"] == "liability"
    assert body["role"] == "mortgage"
    assert body["opening_balance"] == "5000.00"
    assert body["balance"] == "-5000.00"


def test_liability_cannot_owe_a_negative_amount(client, headers):
    resp = make(client, headers, type="liability", opening_balance="-1.00")
    assert resp.status_code == 422
    assert resp.json()["code"] == "validation_error"


def test_default_roles(client, headers):
    assert make(client, headers, name="A").json()["role"] == "checking"
    assert make(client, headers, name="B", type="liability").json()["role"] == "debt"


def test_role_must_match_the_type(client, headers):
    assert make(client, headers, type="asset", role="mortgage").status_code == 422
    assert make(client, headers, type="liability", role="savings").status_code == 422


@pytest.mark.parametrize("bad_type", ["expense", "revenue", "initial_balance", "reconciliation", "banana"])
def test_users_cannot_create_system_or_counterparty_types(client, headers, bad_type):
    assert make(client, headers, type=bad_type).status_code == 422


def test_unknown_currency_is_rejected_and_nothing_is_left_behind(client, headers, db_session):
    resp = make(client, headers, currency_code="XXX", opening_balance="10.00")
    assert resp.status_code == 400
    assert resp.json()["code"] == "currency_not_found"
    assert db_session.query(Account).count() == 0
    assert db_session.query(Transaction).count() == 0


def test_currency_code_is_case_insensitive(client, headers):
    assert make(client, headers, currency_code="usd").json()["currency_code"] == "USD"


@pytest.mark.parametrize("amount", ["10.555", "1e3x", "abc"])
def test_invalid_amounts_are_rejected(client, headers, amount):
    assert make(client, headers, opening_balance=amount).status_code == 422


def test_yen_has_no_decimals(client, headers):
    resp = make(client, headers, name="Tokyo", currency_code="JPY", opening_balance="100.50")
    assert resp.status_code == 400
    assert resp.json()["code"] == "invalid_amount"
    assert make(client, headers, name="Tokyo", currency_code="JPY", opening_balance="100").status_code == 201


def test_amount_too_large_is_rejected(client, headers):
    assert make(client, headers, opening_balance="1" + "0" * 17).status_code == 422


def test_name_is_trimmed_and_required(client, headers):
    assert make(client, headers, name="  Nubank  ").json()["name"] == "Nubank"
    assert make(client, headers, name="   ").status_code == 422
    assert make(client, headers, name="").status_code == 422


def test_duplicate_name_is_rejected_ignoring_case(client, headers):
    assert make(client, headers, name="Nubank").status_code == 201
    resp = make(client, headers, name="nubank")
    assert resp.status_code == 409
    assert resp.json()["code"] == "account_name_taken"


def test_same_name_is_fine_for_a_different_type(client, headers):
    assert make(client, headers, name="Itau", type="asset").status_code == 201
    assert make(client, headers, name="Itau", type="liability").status_code == 201


def test_one_system_account_per_user_and_currency(client, headers, db_session):
    make(client, headers, name="A", opening_balance="1.00")
    make(client, headers, name="B", opening_balance="2.00")
    make(client, headers, name="C", currency_code="USD", opening_balance="3.00")
    names = sorted(a.name for a in db_session.query(Account).filter(Account.type == AccountType.initial_balance))
    assert names == ["Saldo inicial (BRL)", "Saldo inicial (USD)"]


# ---------- Listar e ler ----------


def test_list_hides_system_accounts(client, headers):
    make(client, headers, opening_balance="10.00")
    items = client.get(URL, headers=headers).json()["items"]
    assert [a["name"] for a in items] == ["Nubank"]


def test_list_has_balances_for_each_account(client, headers):
    make(client, headers, name="A", opening_balance="10.00")
    make(client, headers, name="B", opening_balance="20.50")
    make(client, headers, name="C")
    balances = {a["name"]: a["balance"] for a in client.get(URL, headers=headers).json()["items"]}
    assert balances == {"A": "10.00", "B": "20.50", "C": "0.00"}


def test_list_is_sorted_by_name_ignoring_case_and_paginated(client, headers):
    for name in ["banco", "Caixa", "Alfa", "delta"]:
        make(client, headers, name=name)
    page = client.get(f"{URL}?limit=2&offset=1", headers=headers).json()
    assert page["total"] == 4
    assert [a["name"] for a in page["items"]] == ["banco", "Caixa"]


def test_list_filters_by_type_and_active(client, headers):
    make(client, headers, name="Conta")
    make(client, headers, name="Divida", type="liability")
    arquivada = make(client, headers, name="Antiga").json()["id"]
    client.patch(f"{URL}/{arquivada}", json={"active": False}, headers=headers)

    def names(query):
        return sorted(a["name"] for a in client.get(f"{URL}?{query}", headers=headers).json()["items"])

    assert names("type=liability") == ["Divida"]
    assert names("type=asset") == ["Antiga", "Conta"]
    assert names("active=true") == ["Conta", "Divida"]
    assert names("active=false") == ["Antiga"]


def test_list_rejects_system_type_filter(client, headers):
    assert client.get(f"{URL}?type=initial_balance", headers=headers).status_code == 422


def test_get_one_account(client, headers):
    account_id = make(client, headers, opening_balance="7.00").json()["id"]
    resp = client.get(f"{URL}/{account_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["balance"] == "7.00"


def test_unknown_account_is_404(client, headers):
    resp = client.get(f"{URL}/{uuid.uuid4()}", headers=headers)
    assert resp.status_code == 404
    assert resp.json()["code"] == "account_not_found"


def test_system_accounts_cannot_be_read_by_id(client, headers, db_session):
    make(client, headers, opening_balance="10.00")
    system = db_session.query(Account).filter(Account.type == AccountType.initial_balance).one()
    assert client.get(f"{URL}/{system.id}", headers=headers).status_code == 404


# ---------- Isolamento entre usuarios ----------


def test_users_only_see_their_own_accounts(client, headers, db_session):
    make(client, headers, name="Da Ana")
    other = other_user_headers(client, db_session)
    make(client, other, name="Do Bruno")

    assert [a["name"] for a in client.get(URL, headers=headers).json()["items"]] == ["Da Ana"]
    assert [a["name"] for a in client.get(URL, headers=other).json()["items"]] == ["Do Bruno"]


def test_another_users_account_is_404_for_read_update_and_delete(client, headers, db_session):
    account_id = make(client, headers, opening_balance="50.00").json()["id"]
    other = other_user_headers(client, db_session)

    assert client.get(f"{URL}/{account_id}", headers=other).status_code == 404
    assert client.patch(f"{URL}/{account_id}", json={"name": "Roubada"}, headers=other).status_code == 404
    assert client.delete(f"{URL}/{account_id}", headers=other).status_code == 404

    mine = client.get(f"{URL}/{account_id}", headers=headers).json()
    assert mine["name"] == "Nubank"
    assert mine["balance"] == "50.00"


def test_two_users_can_use_the_same_account_name_and_have_separate_system_accounts(client, headers, db_session):
    make(client, headers, name="Nubank", opening_balance="1.00")
    other = other_user_headers(client, db_session)
    assert make(client, other, name="Nubank", opening_balance="2.00").status_code == 201
    assert db_session.query(Account).filter(Account.type == AccountType.initial_balance).count() == 2


# ---------- Editar ----------


def test_rename_and_edit_details(client, headers):
    account_id = make(client, headers).json()["id"]
    resp = client.patch(
        f"{URL}/{account_id}",
        json={"name": "Nubank Roxinho", "role": "savings", "iban": "BR1500000000", "notes": "principal"},
        headers=headers,
    )
    body = resp.json()
    assert body["name"] == "Nubank Roxinho"
    assert body["role"] == "savings"
    assert body["iban"] == "BR1500000000"
    assert body["notes"] == "principal"


def test_rename_to_a_taken_name_is_rejected_but_keeping_the_name_is_fine(client, headers):
    make(client, headers, name="Itau")
    account_id = make(client, headers, name="Nubank").json()["id"]
    assert client.patch(f"{URL}/{account_id}", json={"name": "itau"}, headers=headers).status_code == 409
    assert client.patch(f"{URL}/{account_id}", json={"name": "Nubank"}, headers=headers).status_code == 200


def test_notes_can_be_cleared_with_null(client, headers):
    account_id = make(client, headers, notes="x").json()["id"]
    body = client.patch(f"{URL}/{account_id}", json={"notes": None}, headers=headers).json()
    assert body["notes"] is None


def test_editing_one_field_does_not_touch_the_others(client, headers):
    account_id = make(client, headers, notes="manter", opening_balance="10.00").json()["id"]
    body = client.patch(f"{URL}/{account_id}", json={"name": "Novo"}, headers=headers).json()
    assert body["notes"] == "manter"
    assert body["balance"] == "10.00"


def test_currency_and_type_cannot_be_changed(client, headers):
    account_id = make(client, headers).json()["id"]
    assert client.patch(f"{URL}/{account_id}", json={"currency_code": "USD"}, headers=headers).status_code == 422
    assert client.patch(f"{URL}/{account_id}", json={"type": "liability"}, headers=headers).status_code == 422


def test_role_must_match_the_type_on_update(client, headers):
    account_id = make(client, headers).json()["id"]
    resp = client.patch(f"{URL}/{account_id}", json={"role": "mortgage"}, headers=headers)
    assert resp.status_code == 400


def test_archive_and_restore(client, headers):
    account_id = make(client, headers, opening_balance="10.00").json()["id"]
    assert client.patch(f"{URL}/{account_id}", json={"active": False}, headers=headers).json()["active"] is False
    # Arquivada continua existindo, com o saldo
    assert client.get(f"{URL}/{account_id}", headers=headers).json()["balance"] == "10.00"
    assert client.patch(f"{URL}/{account_id}", json={"active": True}, headers=headers).json()["active"] is True


def test_update_opening_balance_changes_balance_without_duplicating_the_transaction(client, headers, db_session):
    account_id = make(client, headers, opening_balance="100.00").json()["id"]
    body = client.patch(f"{URL}/{account_id}", json={"opening_balance": "250.75"}, headers=headers).json()
    assert body["balance"] == "250.75"
    assert body["opening_balance"] == "250.75"
    assert db_session.query(TransactionSplit).count() == 1


def test_editing_details_and_opening_balance_in_the_same_request_applies_everything(client, headers):
    """Regressao: trocar o saldo inicial recria a transacao de abertura, e isso nao pode
    descartar o nome, o papel e as notas que vieram na mesma edicao."""
    account_id = make(client, headers, opening_balance="100.00").json()["id"]
    resp = client.patch(
        f"{URL}/{account_id}",
        json={
            "name": "Nubank Roxinho",
            "role": "savings",
            "notes": "reserva",
            "active": False,
            "opening_balance": "250.00",
        },
        headers=headers,
    )
    body = resp.json()
    assert body["name"] == "Nubank Roxinho"
    assert body["role"] == "savings"
    assert body["notes"] == "reserva"
    assert body["active"] is False
    assert body["balance"] == "250.00"

    # E persistiu de verdade, nao so na resposta
    saved = client.get(f"{URL}/{account_id}", headers=headers).json()
    assert saved["name"] == "Nubank Roxinho"
    assert saved["notes"] == "reserva"


def test_removing_the_opening_balance_keeps_the_other_edits(client, headers):
    account_id = make(client, headers, opening_balance="100.00").json()["id"]
    body = client.patch(
        f"{URL}/{account_id}", json={"name": "Outro nome", "opening_balance": "0"}, headers=headers
    ).json()
    assert body["name"] == "Outro nome"
    assert body["balance"] == "0.00"


def test_update_opening_balance_can_flip_the_direction(client, headers):
    account_id = make(client, headers, opening_balance="100.00").json()["id"]
    body = client.patch(f"{URL}/{account_id}", json={"opening_balance": "-40.00"}, headers=headers).json()
    assert body["balance"] == "-40.00"


def test_update_only_the_opening_date_keeps_the_amount(client, headers):
    account_id = make(client, headers, opening_balance="100.00", opening_balance_date="2026-01-01").json()["id"]
    body = client.patch(f"{URL}/{account_id}", json={"opening_balance_date": "2026-03-10"}, headers=headers).json()
    assert body["opening_balance"] == "100.00"
    assert body["opening_balance_date"] == "2026-03-10"


def test_set_opening_balance_on_an_account_created_without_one(client, headers):
    account_id = make(client, headers).json()["id"]
    body = client.patch(f"{URL}/{account_id}", json={"opening_balance": "30.00"}, headers=headers).json()
    assert body["balance"] == "30.00"


def test_setting_opening_balance_to_zero_removes_the_transaction(client, headers, db_session):
    account_id = make(client, headers, opening_balance="100.00").json()["id"]
    body = client.patch(f"{URL}/{account_id}", json={"opening_balance": "0"}, headers=headers).json()
    assert body["balance"] == "0.00"
    assert db_session.query(TransactionSplit).count() == 0
    assert db_session.query(Transaction).count() == 0


def test_update_opening_balance_respects_currency_decimals_and_liability_sign(client, headers):
    yen = make(client, headers, name="Tokyo", currency_code="JPY", opening_balance="100").json()["id"]
    assert client.patch(f"{URL}/{yen}", json={"opening_balance": "1.5"}, headers=headers).status_code == 400
    debt = make(client, headers, name="Div", type="liability", opening_balance="10").json()["id"]
    assert client.patch(f"{URL}/{debt}", json={"opening_balance": "-5"}, headers=headers).status_code == 400


# ---------- Excluir ----------


def test_delete_account_with_only_the_opening_balance_removes_everything(client, headers, db_session):
    account_id = make(client, headers, opening_balance="100.00").json()["id"]
    assert client.delete(f"{URL}/{account_id}", headers=headers).status_code == 204
    assert client.get(f"{URL}/{account_id}", headers=headers).status_code == 404
    assert db_session.query(TransactionSplit).count() == 0
    assert db_session.query(Transaction).count() == 0


def test_delete_account_with_other_transactions_is_refused(client, headers, db_session):
    first = uuid.UUID(make(client, headers, name="A", opening_balance="100.00").json()["id"])
    second = uuid.UUID(make(client, headers, name="B").json()["id"])
    user_id = db_session.get(Account, first).user_id
    transaction = Transaction(user_id=user_id)
    db_session.add(transaction)
    db_session.flush()
    db_session.add(
        TransactionSplit(
            transaction_id=transaction.id,
            user_id=user_id,
            type=TransactionType.transfer,
            date=date(2026, 3, 1),
            description="Transferencia",
            source_account_id=first,
            destination_account_id=second,
            amount=25,
            currency_code="BRL",
        )
    )
    db_session.commit()

    for account_id in (first, second):
        resp = client.delete(f"{URL}/{account_id}", headers=headers)
        assert resp.status_code == 409
        assert resp.json()["code"] == "account_has_transactions"

    balances = {a["name"]: a["balance"] for a in client.get(URL, headers=headers).json()["items"]}
    assert balances == {"A": "75.00", "B": "25.00"}


def test_delete_unknown_account_is_404(client, headers):
    assert client.delete(f"{URL}/{uuid.uuid4()}", headers=headers).status_code == 404
