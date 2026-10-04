from decimal import Decimal

import pytest

from tests.conftest import auth_headers, make_user, register

API = "/api/v1"
RECON = f"{API}/reconciliation"
ACCOUNTS = f"{API}/accounts"
TX = f"{API}/transactions"
STATEMENT_DATE = "2026-03-31"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_account(client, headers, kind="asset", name="Nubank", opening="1000.00"):
    body = {"name": name, "type": kind, "currency_code": "BRL", "opening_balance": opening, "opening_balance_date": "2026-01-01"}
    response = client.post(ACCOUNTS, json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.fixture
def account_id(client, headers):
    return make_account(client, headers)


def post_tx(client, headers, account_id, amount, kind="withdrawal", on="2026-03-10", description="Compra"):
    split = {
        "type": kind, "date": on, "description": description, "amount": amount, "currency_code": "BRL",
        "account_id": account_id, "counterparty_name": "Loja",
    }
    response = client.post(TX, json={"splits": [split]}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def split_id_of(created):
    return created["splits"][0]["id"]


def edit_body(created, **changes):
    """O corpo de uma edicao, no formato de entrada (a saida traz campos a mais)."""
    split = {
        "type": "withdrawal", "date": "2026-03-10", "description": "Compra", "amount": "100.00", "currency_code": "BRL",
        "account_id": created["splits"][0]["source_account_id"], "counterparty_name": "Loja", **changes,
    }
    return {"splits": [split]}


def view(client, headers, account_id, balance, on=STATEMENT_DATE):
    response = client.get(f"{RECON}/{account_id}", params={"statement_balance": balance, "statement_date": on}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def clear(client, headers, account_id, split_ids, cleared=True):
    return client.put(f"{RECON}/{account_id}/cleared", json={"split_ids": split_ids, "cleared": cleared}, headers=headers)


def close(client, headers, account_id, balance, on=STATEMENT_DATE):
    return client.post(f"{RECON}/{account_id}/close", json={"statement_balance": balance, "statement_date": on}, headers=headers)


def reconciled_setup(client, headers, account_id):
    """Saldo inicial 1000, compra de 100 conferida: o extrato certo mostra 900."""
    created = post_tx(client, headers, account_id, "100.00")
    assert clear(client, headers, account_id, [split_id_of(created)]).status_code == 200
    return created


# ---------- A tela de conciliacao ----------


def test_opening_balance_counts_as_cleared(client, headers, account_id):
    post_tx(client, headers, account_id, "100.00")
    data = view(client, headers, account_id, "1000.00")
    assert Decimal(data["cleared_balance"]) == Decimal("1000.00")
    assert Decimal(data["book_balance"]) == Decimal("900.00")
    assert Decimal(data["difference"]) == Decimal("0.00")
    assert data["reconciled"] is True
    assert len(data["rows"]) == 1
    assert data["rows"][0]["cleared"] is False
    assert Decimal(data["rows"][0]["amount"]) == Decimal("-100.00")


def test_clearing_moves_the_cleared_balance_and_the_difference(client, headers, account_id):
    created = post_tx(client, headers, account_id, "100.00")
    post_tx(client, headers, account_id, "50.00", kind="deposit", on="2026-03-12", description="Pix")
    assert clear(client, headers, account_id, [split_id_of(created)]).json() == {"changed": 1}
    data = view(client, headers, account_id, "950.00")
    assert Decimal(data["cleared_balance"]) == Decimal("900.00")
    assert Decimal(data["difference"]) == Decimal("50.00")
    assert data["reconciled"] is False


def test_clearing_twice_changes_nothing_and_unclearing_works(client, headers, account_id):
    created = post_tx(client, headers, account_id, "100.00")
    sid = split_id_of(created)
    assert clear(client, headers, account_id, [sid]).json() == {"changed": 1}
    assert clear(client, headers, account_id, [sid]).json() == {"changed": 0}
    assert clear(client, headers, account_id, [sid], cleared=False).json() == {"changed": 1}
    assert Decimal(view(client, headers, account_id, "900.00")["cleared_balance"]) == Decimal("1000.00")


def test_transactions_after_the_statement_date_do_not_count(client, headers, account_id):
    post_tx(client, headers, account_id, "100.00", on="2026-04-05")
    data = view(client, headers, account_id, "1000.00")
    assert data["rows"] == []
    assert Decimal(data["book_balance"]) == Decimal("1000.00")


def test_statement_date_cannot_be_in_the_future(client, headers, account_id):
    response = client.get(f"{RECON}/{account_id}", params={"statement_balance": "1.00", "statement_date": "2999-01-01"}, headers=headers)
    assert response.status_code == 422
    response = close(client, headers, account_id, "1.00", on="2999-01-01")
    assert response.status_code == 422


def test_only_active_asset_accounts_can_be_reconciled(client, headers):
    liability = make_account(client, headers, kind="liability", name="Cartao")
    response = client.get(f"{RECON}/{liability}", params={"statement_balance": "0", "statement_date": STATEMENT_DATE}, headers=headers)
    assert response.status_code == 400
    assert response.json()["code"] == "reconciliation_account_invalid"


def test_cannot_clear_a_split_of_another_account(client, headers, account_id):
    other = make_account(client, headers, name="Itau")
    created = post_tx(client, headers, other, "10.00")
    response = clear(client, headers, account_id, [split_id_of(created)])
    assert response.status_code == 400
    assert response.json()["code"] == "reconciliation_split_invalid"


def test_other_users_cannot_see_the_account(client, db_session, headers, account_id):
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    response = client.get(f"{RECON}/{account_id}", params={"statement_balance": "0", "statement_date": STATEMENT_DATE}, headers=other)
    assert response.status_code in (400, 404)


# ---------- Ajuste ----------


def test_adjustment_creates_a_cleared_transaction_that_zeroes_the_difference(client, headers, account_id):
    reconciled_setup(client, headers, account_id)
    before = view(client, headers, account_id, "880.00")
    assert Decimal(before["difference"]) == Decimal("-20.00")
    response = client.post(f"{RECON}/{account_id}/adjustment", json={"statement_balance": "880.00", "statement_date": STATEMENT_DATE}, headers=headers)
    assert response.status_code == 201, response.text
    after = response.json()
    assert Decimal(after["difference"]) == Decimal("0.00")
    assert after["reconciled"] is True
    adjustment = [row for row in after["rows"] if "juste" in row["description"]]
    assert len(adjustment) == 1
    assert adjustment[0]["cleared"] is True
    assert Decimal(adjustment[0]["amount"]) == Decimal("-20.00")


def test_adjustment_upwards_is_a_deposit(client, headers, account_id):
    reconciled_setup(client, headers, account_id)
    response = client.post(f"{RECON}/{account_id}/adjustment", json={"statement_balance": "930.00", "statement_date": STATEMENT_DATE}, headers=headers)
    assert response.status_code == 201
    row = [row for row in response.json()["rows"] if "juste" in row["description"]][0]
    assert Decimal(row["amount"]) == Decimal("30.00")


def test_adjustment_without_difference_is_refused(client, headers, account_id):
    reconciled_setup(client, headers, account_id)
    response = client.post(f"{RECON}/{account_id}/adjustment", json={"statement_balance": "900.00", "statement_date": STATEMENT_DATE}, headers=headers)
    assert response.status_code == 400
    assert response.json()["code"] == "reconciliation_no_difference"


# ---------- Fechar e travar ----------


def test_close_needs_zero_difference(client, headers, account_id):
    reconciled_setup(client, headers, account_id)
    response = close(client, headers, account_id, "901.00")
    assert response.status_code == 400
    assert response.json()["code"] == "reconciliation_difference"


def test_close_needs_at_least_one_cleared_transaction(client, headers, account_id):
    response = close(client, headers, account_id, "1000.00")
    assert response.status_code == 400
    assert response.json()["code"] == "reconciliation_nothing"


def test_close_locks_and_blocks_edit_and_delete(client, headers, account_id):
    created = reconciled_setup(client, headers, account_id)
    response = close(client, headers, account_id, "900.00")
    assert response.status_code == 201, response.text
    assert response.json()["locked_count"] == 1
    assert response.json()["invalidated_at"] is None

    shown = client.get(f"{TX}/{created['id']}", headers=headers).json()
    assert shown["splits"][0]["cleared"] is True
    assert shown["splits"][0]["locked"] is True

    body = edit_body(created, amount="90.00")
    edit = client.put(f"{TX}/{created['id']}", json=body, headers=headers)
    assert edit.status_code == 409
    assert edit.json()["code"] == "transaction_locked"
    assert client.delete(f"{TX}/{created['id']}", headers=headers).status_code == 409


def test_locked_cannot_be_unmarked(client, headers, account_id):
    created = reconciled_setup(client, headers, account_id)
    assert close(client, headers, account_id, "900.00").status_code == 201
    response = clear(client, headers, account_id, [split_id_of(created)], cleared=False)
    assert response.status_code == 409
    assert response.json()["code"] == "transaction_locked"


def test_unlock_frees_the_transaction_and_invalidates_the_reconciliation(client, headers, account_id):
    created = reconciled_setup(client, headers, account_id)
    assert close(client, headers, account_id, "900.00").status_code == 201
    response = client.post(f"{RECON}/{account_id}/unlock", json={"split_ids": [split_id_of(created)]}, headers=headers)
    assert response.json() == {"changed": 1}
    history = client.get(f"{RECON}/{account_id}/history", headers=headers).json()
    assert len(history) == 1
    assert history[0]["invalidated_at"] is not None
    assert history[0]["locked_count"] == 0
    shown = client.get(f"{TX}/{created['id']}", headers=headers).json()
    assert shown["splits"][0]["cleared"] is True
    assert shown["splits"][0]["locked"] is False
    assert client.delete(f"{TX}/{created['id']}", headers=headers).status_code == 204


def test_undo_reconciliation_unlocks_everything_and_keeps_history(client, headers, account_id):
    created = reconciled_setup(client, headers, account_id)
    record = close(client, headers, account_id, "900.00").json()
    response = client.delete(f"{RECON}/{account_id}/closed/{record['id']}", headers=headers)
    assert response.json() == {"changed": 1}
    history = client.get(f"{RECON}/{account_id}/history", headers=headers).json()
    assert [item["id"] for item in history] == [record["id"]]
    assert history[0]["invalidated_at"] is not None
    assert client.get(f"{TX}/{created['id']}", headers=headers).json()["splits"][0]["locked"] is False


def test_undo_unknown_reconciliation_is_404(client, headers, account_id):
    response = client.delete(f"{RECON}/{account_id}/closed/00000000-0000-0000-0000-000000000000", headers=headers)
    assert response.status_code == 404
    assert response.json()["code"] == "reconciliation_not_found"


def test_second_reconciliation_only_locks_new_ones(client, headers, account_id):
    reconciled_setup(client, headers, account_id)
    first = close(client, headers, account_id, "900.00").json()
    later = post_tx(client, headers, account_id, "40.00", on="2026-04-10")
    assert clear(client, headers, account_id, [split_id_of(later)]).status_code == 200
    second = close(client, headers, account_id, "860.00", on="2026-04-30")
    assert second.status_code == 201, second.text
    assert second.json()["locked_count"] == 1
    history = client.get(f"{RECON}/{account_id}/history", headers=headers).json()
    assert {item["id"]: item["locked_count"] for item in history}[first["id"]] == 1


# ---------- Edicao de lancamento conferido ----------


def test_editing_a_cleared_but_unlocked_transaction_keeps_it_cleared(client, headers, account_id):
    created = reconciled_setup(client, headers, account_id)
    body = edit_body(created, description="Compra editada")
    response = client.put(f"{TX}/{created['id']}", json=body, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["splits"][0]["cleared"] is True
    assert Decimal(view(client, headers, account_id, "900.00")["cleared_balance"]) == Decimal("900.00")


# ---------- Casos de borda (cobrem o que a mutacao apontou) ----------


def test_opening_balance_after_the_statement_date_does_not_count(client, headers):
    body = {"name": "Nova", "type": "asset", "currency_code": "BRL", "opening_balance": "500.00", "opening_balance_date": "2026-03-20"}
    new_id = client.post(ACCOUNTS, json=body, headers=headers).json()["id"]
    data = view(client, headers, new_id, "0.00", on="2026-03-10")
    assert Decimal(data["cleared_balance"]) == Decimal("0.00")


def test_cleared_after_the_statement_date_is_left_out_of_the_cleared_balance(client, headers, account_id):
    later = post_tx(client, headers, account_id, "100.00", on="2026-04-05")
    later_in = post_tx(client, headers, account_id, "30.00", kind="deposit", on="2026-04-06", description="Pix")
    assert clear(client, headers, account_id, [split_id_of(later), split_id_of(later_in)]).status_code == 200
    data = view(client, headers, account_id, "1000.00", on=STATEMENT_DATE)
    assert Decimal(data["cleared_balance"]) == Decimal("1000.00")
    assert data["rows"] == []


def test_locked_rows_leave_the_list(client, headers, account_id):
    reconciled_setup(client, headers, account_id)
    open_one = post_tx(client, headers, account_id, "10.00", on="2026-03-15", description="Aberta")
    assert close(client, headers, account_id, "900.00").status_code == 201
    rows = view(client, headers, account_id, "890.00")["rows"]
    assert [row["split_id"] for row in rows] == [split_id_of(open_one)]


def test_rows_come_newest_first(client, headers, account_id):
    post_tx(client, headers, account_id, "10.00", on="2026-03-05", description="Antiga")
    post_tx(client, headers, account_id, "10.00", on="2026-03-25", description="Nova")
    post_tx(client, headers, account_id, "10.00", on="2026-03-15", description="Meio")
    rows = view(client, headers, account_id, "970.00")["rows"]
    assert [row["date"] for row in rows] == ["2026-03-25", "2026-03-15", "2026-03-05"]


def test_rows_are_truncated_and_say_so(client, headers, account_id, monkeypatch):
    monkeypatch.setattr("app.services.reconciliation.MAX_ROWS", 2)
    for day in (5, 6, 7):
        post_tx(client, headers, account_id, "10.00", on=f"2026-03-0{day}")
    data = view(client, headers, account_id, "970.00")
    assert len(data["rows"]) == 2
    assert data["total_rows"] == 3
    assert data["truncated"] is True


def test_opening_balance_cannot_be_cleared(client, db_session, headers, account_id):
    from sqlalchemy import select

    from app.models.transaction import TransactionSplit, TransactionType

    opening = db_session.execute(select(TransactionSplit.id).where(TransactionSplit.type == TransactionType.opening_balance)).scalars().first()
    response = clear(client, headers, account_id, [str(opening)])
    assert response.status_code == 400
    assert response.json()["code"] == "reconciliation_split_invalid"


def test_cannot_clear_a_split_of_another_user(client, db_session, headers, account_id):
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    other_account = make_account(client, other)
    created = post_tx(client, other, other_account, "10.00")
    response = clear(client, headers, account_id, [split_id_of(created)])
    assert response.status_code == 400
    assert response.json()["code"] == "reconciliation_split_invalid"


def test_close_only_locks_up_to_the_statement_date(client, headers, account_id):
    reconciled_setup(client, headers, account_id)
    later = post_tx(client, headers, account_id, "40.00", on="2026-04-10")
    assert clear(client, headers, account_id, [split_id_of(later)]).status_code == 200
    record = close(client, headers, account_id, "900.00").json()
    assert record["locked_count"] == 1
    shown = client.get(f"{TX}/{later['id']}", headers=headers).json()
    assert shown["splits"][0]["cleared"] is True
    assert shown["splits"][0]["locked"] is False


def test_history_comes_newest_statement_first(client, headers, account_id):
    reconciled_setup(client, headers, account_id)
    first = close(client, headers, account_id, "900.00").json()
    later = post_tx(client, headers, account_id, "40.00", on="2026-04-10")
    clear(client, headers, account_id, [split_id_of(later)])
    second = close(client, headers, account_id, "860.00", on="2026-04-30").json()
    history = client.get(f"{RECON}/{account_id}/history", headers=headers).json()
    assert [item["id"] for item in history] == [second["id"], first["id"]]


def test_undo_with_another_account_is_404(client, headers, account_id):
    reconciled_setup(client, headers, account_id)
    record = close(client, headers, account_id, "900.00").json()
    other = make_account(client, headers, name="Itau")
    response = client.delete(f"{RECON}/{other}/closed/{record['id']}", headers=headers)
    assert response.status_code == 404
    assert client.get(f"{RECON}/{account_id}/history", headers=headers).json()[0]["invalidated_at"] is None


def test_editing_keeps_clearing_only_on_the_side_that_stayed(client, db_session, headers, account_id):
    from sqlalchemy import func, select

    from app.models.reconciliation import AccountClearing

    created = reconciled_setup(client, headers, account_id)
    other = make_account(client, headers, name="Itau")
    response = client.put(f"{TX}/{created['id']}", json=edit_body(created, account_id=other), headers=headers)
    assert response.status_code == 200, response.text
    assert db_session.scalar(select(func.count()).select_from(AccountClearing)) == 0


def test_editing_keeps_clearing_on_the_same_split_position(client, headers, account_id):
    def split(description, amount):
        return {
            "type": "withdrawal", "date": "2026-03-10", "description": description, "amount": amount, "currency_code": "BRL",
            "account_id": account_id, "counterparty_name": "Loja",
        }

    body = {"splits": [split("Primeira", "10.00"), split("Segunda", "20.00")]}
    created = client.post(TX, json=body, headers=headers).json()
    assert clear(client, headers, account_id, [created["splits"][1]["id"]]).status_code == 200
    response = client.put(f"{TX}/{created['id']}", json=body, headers=headers)
    assert response.status_code == 200, response.text
    assert [item["cleared"] for item in response.json()["splits"]] == [False, True]
