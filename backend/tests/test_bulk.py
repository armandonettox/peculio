import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.core import clock
from app.models.transaction import Transaction, TransactionSplit, TransactionType
from app.models.webhook import WebhookDelivery
from tests.conftest import auth_headers, make_user, register
from tests.webhook_support import no_real_dns, server  # noqa: F401

API = "/api/v1"
BULK = f"{API}/transactions/bulk"
TX = f"{API}/transactions"
ACCOUNTS = f"{API}/accounts"
RECON = f"{API}/reconciliation"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_account(client, headers, name="Nubank", kind="asset", currency="BRL", opening="1000.00"):
    body = {"name": name, "type": kind, "currency_code": currency, "opening_balance": opening, "opening_balance_date": "2026-01-01"}
    response = client.post(ACCOUNTS, json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.fixture
def account_id(client, headers):
    return make_account(client, headers)


def make_category(client, headers, name="Mercado", kind="expense"):
    response = client.post(f"{API}/categories", json={"name": name, "kind": kind}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def make_tag(client, headers, name="casa"):
    response = client.post(f"{API}/tags", json={"name": name}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def split(account_id, description="Compra", amount="50.00", on="2026-03-10", kind="withdrawal", **extra):
    return {
        "type": kind, "date": on, "description": description, "amount": amount, "currency_code": "BRL",
        "account_id": account_id, "counterparty_name": "Loja", **extra,
    }


def post_tx(client, headers, splits, **extra):
    response = client.post(TX, json={"splits": splits, **extra}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def get_tx(client, headers, transaction_id):
    response = client.get(f"{TX}/{transaction_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def bulk(client, headers, ids, action, **extra):
    return client.post(BULK, json={"ids": ids, "action": action, **extra}, headers=headers)


def lock(client, headers, account_id, transaction):
    """Confere e fecha a conciliacao do lancamento, deixando-o travado."""
    split_id = transaction["splits"][0]["id"]
    assert client.put(f"{RECON}/{account_id}/cleared", json={"split_ids": [split_id], "cleared": True}, headers=headers).status_code == 200
    balance = Decimal("1000.00") - Decimal(transaction["splits"][0]["amount"])
    closed = client.post(
        f"{RECON}/{account_id}/close", json={"statement_balance": str(balance), "statement_date": "2026-03-31"}, headers=headers
    )
    assert closed.status_code == 201, closed.text


# ---------- Mudar categoria ----------


def test_set_category_changes_every_split_of_the_selected_only(client, headers, account_id):
    category = make_category(client, headers)
    one = post_tx(client, headers, [split(account_id, "Um")])
    two = post_tx(client, headers, [split(account_id, "A", "10.00"), split(account_id, "B", "20.00")], title="Dois")
    other = post_tx(client, headers, [split(account_id, "Fora")])

    response = bulk(client, headers, [one["id"], two["id"]], "set_category", category_id=category)
    assert response.status_code == 200, response.text
    assert response.json() == {"affected": 2, "created_ids": []}
    assert get_tx(client, headers, one["id"])["splits"][0]["category_id"] == category
    assert [s["category_id"] for s in get_tx(client, headers, two["id"])["splits"]] == [category, category]
    assert get_tx(client, headers, other["id"])["splits"][0]["category_id"] is None


def test_set_category_without_category_clears_it(client, headers, account_id):
    category = make_category(client, headers)
    created = post_tx(client, headers, [split(account_id, category_id=category)])
    assert bulk(client, headers, [created["id"]], "set_category").status_code == 200
    assert get_tx(client, headers, created["id"])["splits"][0]["category_id"] is None


def test_set_category_with_an_unknown_category_changes_nothing(client, headers, account_id):
    one = post_tx(client, headers, [split(account_id)])
    response = bulk(client, headers, [one["id"]], "set_category", category_id=str(uuid.uuid4()))
    assert response.status_code == 404
    assert response.json()["code"] == "category_not_found"


def test_set_category_cannot_use_a_category_of_another_user(client, db_session, headers, account_id):
    other_user = make_user(db_session, email="outra@example.com")
    other_headers = auth_headers(client, email="outra@example.com")
    foreign = make_category(client, other_headers, "Alheia")
    one = post_tx(client, headers, [split(account_id)])
    response = bulk(client, headers, [one["id"]], "set_category", category_id=foreign)
    assert response.status_code == 404
    assert other_user.id


# ---------- Mudar data ----------


def test_set_date_changes_every_split_of_the_selected_only(client, headers, account_id):
    one = post_tx(client, headers, [split(account_id, "Um")])
    two = post_tx(client, headers, [split(account_id, "A", "10.00"), split(account_id, "B", "20.00")], title="Dois")
    other = post_tx(client, headers, [split(account_id, "Fora")])

    response = bulk(client, headers, [one["id"], two["id"]], "set_date", date="2026-02-01")
    assert response.status_code == 200, response.text
    assert response.json()["affected"] == 2
    assert get_tx(client, headers, one["id"])["splits"][0]["date"] == "2026-02-01"
    assert [s["date"] for s in get_tx(client, headers, two["id"])["splits"]] == ["2026-02-01", "2026-02-01"]
    assert get_tx(client, headers, other["id"])["splits"][0]["date"] == "2026-03-10"


# ---------- Duplicar ----------


def test_duplicate_copies_everything_but_the_date_and_marks(client, headers, account_id):
    category = make_category(client, headers)
    tag = make_tag(client, headers)
    original = post_tx(
        client, headers, [split(account_id, "Mercado", "50.00", category_id=category, tag_ids=[tag], notes="nota", bill_id=None)]
    )
    response = bulk(client, headers, [original["id"]], "duplicate")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["affected"] == 1
    assert len(body["created_ids"]) == 1
    assert body["created_ids"][0] != original["id"]

    copy = get_tx(client, headers, body["created_ids"][0])["splits"][0]
    first = original["splits"][0]
    assert copy["date"] == clock.today().isoformat()
    assert (copy["description"], copy["amount"], copy["type"]) == ("Mercado", "50.00", "withdrawal")
    assert copy["source_account_id"] == first["source_account_id"]
    assert copy["destination_account_id"] == first["destination_account_id"]
    assert copy["category_id"] == category
    assert copy["tag_ids"] == [tag]
    assert copy["notes"] == "nota"
    assert copy["cleared"] is False
    assert copy["locked"] is False
    # O original continua como estava
    assert get_tx(client, headers, original["id"])["splits"][0]["date"] == "2026-03-10"


def test_duplicate_keeps_the_title_and_every_split(client, headers, account_id):
    original = post_tx(client, headers, [split(account_id, "A", "10.00"), split(account_id, "B", "20.00")], title="Compras")
    created = bulk(client, headers, [original["id"]], "duplicate").json()["created_ids"][0]
    copy = get_tx(client, headers, created)
    assert copy["title"] == "Compras"
    assert [(s["description"], s["amount"]) for s in copy["splits"]] == [("A", "10.00"), ("B", "20.00")]


def test_duplicate_works_for_deposits_and_transfers(client, headers, account_id):
    poupanca = make_account(client, headers, "Poupanca")
    deposit = post_tx(client, headers, [split(account_id, "Salario", "300.00", kind="deposit")])
    transfer = post_tx(
        client, headers, [{**split(account_id, "Reserva", "100.00", kind="transfer"), "counterparty_name": None, "counterparty_account_id": poupanca}]
    )
    created = bulk(client, headers, [deposit["id"], transfer["id"]], "duplicate").json()["created_ids"]
    copies = [get_tx(client, headers, transaction_id)["splits"][0] for transaction_id in created]
    assert [c["type"] for c in copies] == ["deposit", "transfer"]
    assert copies[0]["destination_account_id"] == account_id
    assert (copies[1]["source_account_id"], copies[1]["destination_account_id"]) == (account_id, poupanca)


def test_duplicate_returns_the_new_ids_in_the_order_asked(client, headers, account_id):
    a = post_tx(client, headers, [split(account_id, "A")])
    b = post_tx(client, headers, [split(account_id, "B")])
    created = bulk(client, headers, [b["id"], a["id"]], "duplicate").json()["created_ids"]
    assert [get_tx(client, headers, transaction_id)["splits"][0]["description"] for transaction_id in created] == ["B", "A"]


def test_duplicate_does_not_copy_the_bill_link_or_the_clearing(client, headers, account_id):
    original = post_tx(client, headers, [split(account_id, "Aluguel", "800.00")])
    lock(client, headers, account_id, original)
    assert get_tx(client, headers, original["id"])["splits"][0]["locked"] is True
    # Duplicar nao mexe no original: um travado nao atrapalha
    response = bulk(client, headers, [original["id"]], "duplicate")
    assert response.status_code == 200, response.text
    copy = get_tx(client, headers, response.json()["created_ids"][0])["splits"][0]
    assert (copy["cleared"], copy["locked"]) == (False, False)
    assert copy["bill_id"] is None


def test_duplicate_changes_the_balance(client, headers, account_id):
    original = post_tx(client, headers, [split(account_id, "Compra", "50.00")])
    bulk(client, headers, [original["id"]], "duplicate")
    balance = client.get(f"{ACCOUNTS}/{account_id}", headers=headers).json()["balance"]
    assert Decimal(balance) == Decimal("900.00")


# ---------- Excluir ----------


def test_delete_removes_the_selected_only(client, headers, account_id):
    one = post_tx(client, headers, [split(account_id, "Um")])
    two = post_tx(client, headers, [split(account_id, "A", "10.00"), split(account_id, "B", "20.00")], title="Dois")
    other = post_tx(client, headers, [split(account_id, "Fora")])
    response = bulk(client, headers, [one["id"], two["id"]], "delete")
    assert response.status_code == 200, response.text
    assert response.json() == {"affected": 2, "created_ids": []}
    assert client.get(f"{TX}/{one['id']}", headers=headers).status_code == 404
    assert client.get(f"{TX}/{two['id']}", headers=headers).status_code == 404
    assert client.get(f"{TX}/{other['id']}", headers=headers).status_code == 200
    assert Decimal(client.get(f"{ACCOUNTS}/{account_id}", headers=headers).json()["balance"]) == Decimal("950.00")


# ---------- Tudo ou nada ----------


@pytest.mark.parametrize("action,extra", [("set_category", {}), ("set_date", {"date": "2026-02-01"}), ("delete", {})])
def test_a_locked_transaction_blocks_the_whole_action_and_names_it(client, headers, account_id, action, extra):
    free = post_tx(client, headers, [split(account_id, "Livre", "10.00", on="2026-04-05")])
    locked = post_tx(client, headers, [split(account_id, "Travada", "50.00")])
    lock(client, headers, account_id, locked)

    response = bulk(client, headers, [free["id"], locked["id"]], action, **extra)
    assert response.status_code == 409
    assert response.json()["code"] == "transactions_locked"
    assert response.json()["locked_ids"] == [locked["id"]]
    # Nada mudou, nem no lancamento livre
    unchanged = get_tx(client, headers, free["id"])["splits"][0]
    assert (unchanged["date"], unchanged["category_id"]) == ("2026-04-05", None)
    assert client.get(f"{TX}/{locked['id']}", headers=headers).status_code == 200


def test_the_locked_list_keeps_the_order_asked(client, headers, account_id):
    made = [post_tx(client, headers, [split(account_id, f"T{n}", f"{n}0.00", on=f"2026-03-0{n}")]) for n in range(1, 6)]
    for transaction in made:
        assert client.put(
            f"{RECON}/{account_id}/cleared", json={"split_ids": [transaction["splits"][0]["id"]], "cleared": True}, headers=headers
        ).status_code == 200
    # 10 + 20 + 30 + 40 + 50 = 150
    closed = client.post(
        f"{RECON}/{account_id}/close", json={"statement_balance": "850.00", "statement_date": "2026-03-31"}, headers=headers
    )
    assert closed.status_code == 201, closed.text
    asked = [made[3]["id"], made[0]["id"], made[4]["id"], made[2]["id"], made[1]["id"]]
    response = bulk(client, headers, asked, "delete")
    assert response.status_code == 409
    assert response.json()["locked_ids"] == asked


def test_an_unknown_id_blocks_everything(client, headers, account_id):
    one = post_tx(client, headers, [split(account_id)])
    response = bulk(client, headers, [one["id"], str(uuid.uuid4())], "delete")
    assert response.status_code == 404
    assert response.json()["code"] == "transaction_not_found"
    assert client.get(f"{TX}/{one['id']}", headers=headers).status_code == 200


def test_a_transaction_of_another_user_counts_as_not_found(client, db_session, headers, account_id):
    make_user(db_session, email="outra@example.com")
    other_headers = auth_headers(client, email="outra@example.com")
    other_account = make_account(client, other_headers, "Dela")
    theirs = post_tx(client, other_headers, [split(other_account, "Dela")])
    mine = post_tx(client, headers, [split(account_id)])
    response = bulk(client, headers, [mine["id"], theirs["id"]], "delete")
    assert response.status_code == 404
    assert client.get(f"{TX}/{theirs['id']}", headers=other_headers).status_code == 200
    assert client.get(f"{TX}/{mine['id']}", headers=headers).status_code == 200


def test_the_opening_balance_cannot_be_reached_through_a_bulk_action(client, db_session, headers, account_id):
    opening = db_session.execute(
        select(Transaction.id).join(TransactionSplit, TransactionSplit.transaction_id == Transaction.id).where(
            TransactionSplit.type == TransactionType.opening_balance
        )
    ).scalars().first()
    response = bulk(client, headers, [str(opening)], "delete")
    assert response.status_code == 404


# ---------- Pedido invalido ----------


def test_the_list_cannot_be_empty_repeated_or_too_long(client, headers, account_id):
    one = post_tx(client, headers, [split(account_id)])
    assert bulk(client, headers, [], "delete").status_code == 422
    assert bulk(client, headers, [one["id"], one["id"]], "delete").status_code == 422
    assert bulk(client, headers, [str(uuid.uuid4()) for _ in range(201)], "delete").status_code == 422


def test_the_200_limit_itself_is_allowed_by_the_schema(client, headers):
    # 200 ids que nao existem: passa da validacao e cai em "nao encontrado", nao em 422
    response = bulk(client, headers, [str(uuid.uuid4()) for _ in range(200)], "delete")
    assert response.status_code == 404


def test_each_action_takes_only_its_own_fields(client, headers, account_id):
    one = post_tx(client, headers, [split(account_id)])
    category = make_category(client, headers)
    assert bulk(client, headers, [one["id"]], "set_date").status_code == 422
    assert bulk(client, headers, [one["id"]], "delete", date="2026-02-01").status_code == 422
    assert bulk(client, headers, [one["id"]], "duplicate", category_id=category).status_code == 422
    assert bulk(client, headers, [one["id"]], "delete", category_id=category).status_code == 422
    assert bulk(client, headers, [one["id"]], "set_category", date="2026-02-01").status_code == 422
    assert bulk(client, headers, [one["id"]], "inventada").status_code == 422
    assert client.post(BULK, json={"ids": [one["id"]], "action": "delete", "extra": 1}, headers=headers).status_code == 422


# ---------- Webhooks ----------


def make_webhook(client, headers, events):
    response = client.post(f"{API}/webhooks", json={"name": "Casa", "url": "https://hooks.example.com/finance", "events": events}, headers=headers)
    assert response.status_code == 201, response.text


def deliveries(db_session, event):
    db_session.expire_all()
    return [d for d in db_session.execute(select(WebhookDelivery)).scalars() if d.event == event]


def test_each_changed_transaction_notifies_the_webhooks(client, db_session, headers, account_id):
    make_webhook(client, headers, ["transaction.created", "transaction.updated", "transaction.deleted"])
    a = post_tx(client, headers, [split(account_id, "A")])
    b = post_tx(client, headers, [split(account_id, "B")])
    base_created = len(deliveries(db_session, "transaction.created"))

    bulk(client, headers, [a["id"], b["id"]], "set_date", date="2026-02-01")
    assert {d.payload["data"]["id"] for d in deliveries(db_session, "transaction.updated")} == {a["id"], b["id"]}

    bulk(client, headers, [a["id"], b["id"]], "set_category")
    assert len(deliveries(db_session, "transaction.updated")) == 4

    copies = bulk(client, headers, [a["id"], b["id"]], "duplicate").json()["created_ids"]
    created = deliveries(db_session, "transaction.created")
    assert len(created) == base_created + 2
    assert {d.payload["data"]["id"] for d in created} >= set(copies)

    bulk(client, headers, [a["id"], b["id"]], "delete")
    assert {d.payload["data"]["id"] for d in deliveries(db_session, "transaction.deleted")} == {a["id"], b["id"]}


def test_a_refused_action_sends_no_webhook(client, db_session, headers, account_id):
    make_webhook(client, headers, ["transaction.updated", "transaction.deleted"])
    free = post_tx(client, headers, [split(account_id, "Livre", "10.00", on="2026-04-05")])
    locked = post_tx(client, headers, [split(account_id, "Travada", "50.00")])
    lock(client, headers, account_id, locked)
    assert bulk(client, headers, [free["id"], locked["id"]], "set_category").status_code == 409
    assert bulk(client, headers, [free["id"], locked["id"]], "delete").status_code == 409
    assert deliveries(db_session, "transaction.updated") == []
    assert deliveries(db_session, "transaction.deleted") == []


# ---------- O que a copia nao leva e o que ela leva ----------

PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"


@pytest.fixture(autouse=True)
def storage_dir(tmp_path, monkeypatch):
    """Cada teste grava os anexos num diretorio temporario proprio."""
    from app.core.config import settings

    directory = tmp_path / "attachments"
    monkeypatch.setattr(settings, "attachments_dir", str(directory))
    return directory


def files_on_disk(directory):
    return [path for path in directory.rglob("*") if path.is_file()] if directory.exists() else []


def test_duplicate_keeps_the_budget(client, headers, account_id):
    budget = client.post(f"{API}/budgets", json={"name": "Mercado", "currency_code": "BRL", "amount": "800.00", "period": "monthly"}, headers=headers)
    assert budget.status_code == 201, budget.text
    original = post_tx(client, headers, [split(account_id, "Compra", budget_id=budget.json()["id"])])
    copy = bulk(client, headers, [original["id"]], "duplicate").json()["created_ids"][0]
    assert get_tx(client, headers, copy)["splits"][0]["budget_id"] == budget.json()["id"]


def test_duplicate_does_not_pay_the_same_bill_again(client, headers, account_id):
    bill = client.post(
        f"{API}/bills",
        json={
            "name": "Netflix", "currency_code": "BRL", "amount_min": "40.00", "amount_max": "60.00",
            "match_text": "netflix", "first_due_date": "2026-03-05", "frequency": "monthly",
        },
        headers=headers,
    )
    assert bill.status_code == 201, bill.text
    original = post_tx(client, headers, [split(account_id, "Netflix", "50.00", on="2026-03-05")])
    # O original foi ligado sozinho a conta a pagar; a copia nao
    assert get_tx(client, headers, original["id"])["splits"][0]["bill_id"] == bill.json()["id"]
    copy = bulk(client, headers, [original["id"]], "duplicate").json()["created_ids"][0]
    assert get_tx(client, headers, copy)["splits"][0]["bill_id"] is None


def test_duplicate_does_not_copy_attachments(client, headers, account_id, storage_dir):
    original = post_tx(client, headers, [split(account_id)])
    uploaded = client.post(f"{TX}/{original['id']}/attachments", files={"file": ("nota.pdf", PDF, "application/octet-stream")}, headers=headers)
    assert uploaded.status_code == 201, uploaded.text
    copy = bulk(client, headers, [original["id"]], "duplicate").json()["created_ids"][0]
    assert get_tx(client, headers, copy)["attachment_count"] == 0
    assert get_tx(client, headers, original["id"])["attachment_count"] == 1
    assert len(files_on_disk(storage_dir)) == 1


def test_delete_removes_the_attachment_files_from_disk(client, headers, account_id, storage_dir):
    keep = post_tx(client, headers, [split(account_id, "Fica")])
    gone = post_tx(client, headers, [split(account_id, "Sai")])
    for transaction in (keep, gone):
        assert client.post(f"{TX}/{transaction['id']}/attachments", files={"file": ("nota.pdf", PDF, "application/octet-stream")}, headers=headers).status_code == 201
    assert len(files_on_disk(storage_dir)) == 2
    assert bulk(client, headers, [gone["id"]], "delete").status_code == 200
    assert len(files_on_disk(storage_dir)) == 1


def test_duplicate_keeps_the_split_order_by_position_not_by_storage_order(client, db_session, headers, account_id):
    original = post_tx(client, headers, [split(account_id, "A", "10.00"), split(account_id, "B", "20.00"), split(account_id, "C", "30.00")], title="Ordem")
    rows = db_session.execute(select(TransactionSplit).where(TransactionSplit.transaction_id == uuid.UUID(original["id"]))).scalars().all()
    # Inverte as posicoes: a linha gravada primeiro passa a ser a ultima
    for row in rows:
        row.position = {"A": 2, "B": 1, "C": 0}[row.description]
    db_session.commit()
    shown = [(item["description"]) for item in get_tx(client, headers, original["id"])["splits"]]
    assert shown == ["C", "B", "A"]

    created = bulk(client, headers, [original["id"]], "duplicate").json()["created_ids"][0]
    assert [item["description"] for item in get_tx(client, headers, created)["splits"]] == ["C", "B", "A"]
