import uuid

import pytest
from sqlalchemy import select

from app.models.webhook import WebhookDelivery
from app.services import rules_backfill
from tests.conftest import auth_headers, make_user, register
from tests.webhook_support import no_real_dns, server  # noqa: F401

API = "/api/v1"
PREVIEW = f"{API}/rules/preview"
APPLY = f"{API}/rules/apply"
TX = f"{API}/transactions"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def post(client, headers, path, body):
    response = client.post(f"{API}/{path}", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def make_account(client, headers, name="Nubank"):
    return post(
        client, headers, "accounts",
        {"name": name, "type": "asset", "currency_code": "BRL", "opening_balance": "5000.00"},
    )


def make_category(client, headers, name, kind="expense"):
    return post(client, headers, "categories", {"name": name, "kind": kind})


def make_rule(client, headers, name, text, actions, **extra):
    triggers = [{"field": "description", "op": "contains", "value": text}]
    return post(client, headers, "rules", {"name": name, "triggers": triggers, "actions": actions, **extra})


def split(account_id, **overrides):
    return {
        "type": "withdrawal",
        "date": "2026-03-10",
        "description": "Compra no mercado",
        "amount": "120.50",
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Supermercado Central",
        **overrides,
    }


def create(client, headers, **overrides):
    response = client.post(TX, json={"splits": [split(**overrides)]}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def get_split(client, headers, transaction):
    return client.get(f"{TX}/{transaction['id']}", headers=headers).json()["splits"][0]


def preview(client, headers, **body):
    response = client.post(PREVIEW, json=body, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def apply(client, headers, **body):
    response = client.post(APPLY, json=body, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def old_transaction_then_rule(client, headers, account, text="mercado"):
    """O lancamento vem antes da regra: e o caso de uso desta tela."""
    transaction = create(client, headers, account_id=account)
    category = make_category(client, headers, "Mercado")
    rule = make_rule(client, headers, "Mercado", text, [{"kind": "set_category", "target_id": category}])
    return transaction, category, rule


# ---------- Previa e aplicacao ----------


def test_preview_shows_changes_without_saving_and_apply_saves(client, headers):
    account = make_account(client, headers)
    transaction, category, rule = old_transaction_then_rule(client, headers, account)

    shown = preview(client, headers)
    assert (shown["scanned"], shown["changed"], shown["truncated"]) == (1, 1, False)
    item = shown["items"][0]
    assert item["transaction_id"] == transaction["id"]
    assert item["split_id"] == transaction["splits"][0]["id"]
    assert item["description"] == "Compra no mercado"
    assert item["amount"] == "120.50"
    assert item["date"] == "2026-03-10"
    assert item["category_id"] == category
    assert (item["budget_id"], item["bill_id"], item["add_tag_ids"]) == (None, None, [])
    assert item["rule_ids"] == [rule]
    assert get_split(client, headers, transaction)["category_id"] is None

    assert apply(client, headers) == {"scanned": 1, "changed": 1}
    assert get_split(client, headers, transaction)["category_id"] == category
    # Segunda vez nao ha mais nada vazio para preencher
    assert apply(client, headers) == {"scanned": 1, "changed": 0}
    assert preview(client, headers)["items"] == []


def test_only_empty_fields_are_filled_on_old_transactions(client, headers):
    account = make_account(client, headers)
    chosen = make_category(client, headers, "Festa")
    ruled = make_category(client, headers, "Mercado")
    budget = post(client, headers, "budgets", {"name": "Casa", "currency_code": "BRL", "amount": "800.00", "period": "monthly"})
    transaction = create(client, headers, account_id=account, category_id=chosen)
    make_rule(
        client, headers, "Mercado", "mercado",
        [{"kind": "set_category", "target_id": ruled}, {"kind": "set_budget", "target_id": budget}],
    )
    assert apply(client, headers)["changed"] == 1
    saved = get_split(client, headers, transaction)
    assert saved["category_id"] == chosen
    assert saved["budget_id"] == budget


def test_tags_are_added_without_duplicates_and_keep_existing(client, headers):
    account = make_account(client, headers)
    first = post(client, headers, "tags", {"name": "viagem"})
    second = post(client, headers, "tags", {"name": "casa"})
    transaction = create(client, headers, account_id=account, tag_ids=[first])
    make_rule(client, headers, "Tags", "mercado", [{"kind": "add_tag", "target_id": first}, {"kind": "add_tag", "target_id": second}])
    item = preview(client, headers)["items"][0]
    assert item["add_tag_ids"] == [second]
    apply(client, headers)
    assert sorted(get_split(client, headers, transaction)["tag_ids"]) == sorted([first, second])


def test_bill_is_linked_and_invalid_targets_are_skipped(client, headers):
    account = make_account(client, headers)
    bill = post(
        client, headers, "bills",
        {
            "name": "Netflix", "currency_code": "BRL", "amount_min": "40.00", "amount_max": "60.00",
            "match_text": "zzz-nunca-casa", "first_due_date": "2026-03-05", "frequency": "monthly",
        },
    )
    budget = post(client, headers, "budgets", {"name": "Casa", "currency_code": "BRL", "amount": "800.00", "period": "monthly"})
    category = make_category(client, headers, "Salario")
    expense = create(client, headers, account_id=account)
    deposit = create(client, headers, account_id=account, type="deposit", description="Pagamento mercado", counterparty_name="Empresa")
    make_rule(
        client, headers, "Tudo", "mercado",
        [
            {"kind": "set_bill", "target_id": bill},
            {"kind": "set_budget", "target_id": budget},
            {"kind": "set_category", "target_id": category},
        ],
    )
    apply(client, headers)
    saved_expense = get_split(client, headers, expense)
    assert (saved_expense["bill_id"], saved_expense["budget_id"], saved_expense["category_id"]) == (bill, budget, category)
    saved_deposit = get_split(client, headers, deposit)
    # Nenhum dos tres vale para a entrada: orcamento e conta a pagar nunca valem, e a categoria e de saida
    assert (saved_deposit["bill_id"], saved_deposit["budget_id"], saved_deposit["category_id"]) == (None, None, None)


def test_counterparty_account_and_type_triggers_work_on_old_transactions(client, headers):
    first = make_account(client, headers, "Nubank")
    second = make_account(client, headers, "Itau")
    category = make_category(client, headers, "Grande")
    on_first = create(client, headers, account_id=first, description="Outra", amount="1500.00")
    on_second = create(client, headers, account_id=second, description="Outra", amount="1500.00")
    deposit_second = create(client, headers, account_id=second, type="deposit", description="Outra", amount="1500.00")
    post(
        client, headers, "rules",
        {
            "name": "Grande do Itau",
            "triggers": [
                {"field": "amount", "op": "greater_than", "value": "1000"},
                {"field": "account", "op": "is", "value": second},
                {"field": "type", "op": "is", "value": "withdrawal"},
                {"field": "counterparty", "op": "starts_with", "value": "super"},
            ],
            "actions": [{"kind": "set_category", "target_id": category}],
        },
    )
    assert apply(client, headers)["changed"] == 1
    assert get_split(client, headers, on_second)["category_id"] == category
    assert get_split(client, headers, on_first)["category_id"] is None
    assert get_split(client, headers, deposit_second)["category_id"] is None


def test_transfers_use_the_origin_account_and_the_destination_name(client, headers):
    first = make_account(client, headers, "Nubank")
    second = make_account(client, headers, "Itau")
    category = make_category(client, headers, "Reserva")
    transfer = client.post(
        TX,
        json={"splits": [split(first, type="transfer", description="Mover", counterparty_account_id=second, counterparty_name=None)]},
        headers=headers,
    ).json()
    post(
        client, headers, "rules",
        {
            "name": "Para o Itau",
            "triggers": [
                {"field": "account", "op": "is", "value": first},
                {"field": "counterparty", "op": "equals", "value": "itau"},
            ],
            "actions": [{"kind": "set_category", "target_id": category}],
        },
    )
    assert apply(client, headers)["changed"] == 1
    assert get_split(client, headers, transfer)["category_id"] == category


# ---------- Filtros ----------


def test_filters_by_date_and_account(client, headers):
    first = make_account(client, headers, "Nubank")
    second = make_account(client, headers, "Itau")
    march = create(client, headers, account_id=first, date="2026-03-10")
    april = create(client, headers, account_id=first, date="2026-04-10")
    other_account = create(client, headers, account_id=second, date="2026-03-12")
    category = make_category(client, headers, "Mercado")
    make_rule(client, headers, "Mercado", "mercado", [{"kind": "set_category", "target_id": category}])

    assert preview(client, headers, date_from="2026-04-01")["scanned"] == 1
    assert preview(client, headers, date_to="2026-03-31")["scanned"] == 2
    assert preview(client, headers, date_from="2026-03-11", date_to="2026-03-31")["scanned"] == 1
    assert preview(client, headers, date_from="2026-03-10", date_to="2026-03-10")["scanned"] == 1
    assert preview(client, headers, account_id=second)["scanned"] == 1

    assert apply(client, headers, date_from="2026-03-01", date_to="2026-03-31", account_id=first) == {"scanned": 1, "changed": 1}
    assert get_split(client, headers, march)["category_id"] == category
    assert get_split(client, headers, april)["category_id"] is None
    assert get_split(client, headers, other_account)["category_id"] is None


def test_account_filter_also_matches_the_destination_side(client, headers):
    first = make_account(client, headers, "Nubank")
    second = make_account(client, headers, "Itau")
    client.post(
        TX, json={"splits": [split(first, type="transfer", description="Mover", counterparty_account_id=second, counterparty_name=None)]}, headers=headers
    )
    assert preview(client, headers, account_id=second)["scanned"] == 1


def test_opening_balances_are_not_scanned(client, headers):
    make_account(client, headers)
    assert preview(client, headers)["scanned"] == 0


def test_rule_ids_limit_which_rules_run(client, headers):
    account = make_account(client, headers)
    create(client, headers, account_id=account)
    first = make_category(client, headers, "Primeira")
    second = make_category(client, headers, "Segunda")
    one = make_rule(client, headers, "Um", "mercado", [{"kind": "set_category", "target_id": first}], position=0)
    two = make_rule(client, headers, "Dois", "mercado", [{"kind": "set_category", "target_id": second}], position=1)
    assert preview(client, headers)["items"][0]["category_id"] == first
    assert preview(client, headers, rule_ids=[two])["items"][0]["category_id"] == second
    assert preview(client, headers, rule_ids=[one, two])["items"][0]["rule_ids"] == [one, two]


def test_unknown_or_inactive_rule_ids_are_refused(client, headers):
    account = make_account(client, headers)
    create(client, headers, account_id=account)
    category = make_category(client, headers, "Mercado")
    rule = make_rule(client, headers, "Mercado", "mercado", [{"kind": "set_category", "target_id": category}])
    for body in ({"rule_ids": [str(uuid.uuid4())]}, {"rule_ids": [rule, str(uuid.uuid4())]}):
        response = client.post(PREVIEW, json=body, headers=headers)
        assert (response.status_code, response.json()["code"]) == (422, "rule_invalid")
    client.patch(f"{API}/rules/{rule}", json={"active": False}, headers=headers)
    assert client.post(APPLY, json={"rule_ids": [rule]}, headers=headers).status_code == 422


def test_no_active_rules_changes_nothing(client, headers):
    account = make_account(client, headers)
    create(client, headers, account_id=account)
    assert apply(client, headers) == {"scanned": 1, "changed": 0}


# ---------- Validacao e limites ----------


def test_invalid_bodies_are_refused(client, headers):
    for body in (
        {"date_from": "2026-05-01", "date_to": "2026-04-01"},
        {"rule_ids": []},
        {"surprise": 1},
        {"account_id": "nao-e-uuid"},
    ):
        assert client.post(PREVIEW, json=body, headers=headers).status_code == 422, body


def test_account_of_another_user_is_404(client, headers, db_session):
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    foreign = make_account(client, other)
    for url in (PREVIEW, APPLY):
        response = client.post(url, json={"account_id": foreign}, headers=headers)
        assert (response.status_code, response.json()["code"]) == (404, "account_not_found")


def test_requires_login(client):
    assert client.post(PREVIEW, json={}).status_code == 401
    assert client.post(APPLY, json={}).status_code == 401


def test_other_users_transactions_are_never_touched(client, headers, db_session):
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    other_account = make_account(client, other)
    other_tx = create(client, other, account_id=other_account)
    account = make_account(client, headers)
    create(client, headers, account_id=account)
    category = make_category(client, headers, "Mercado")
    make_rule(client, headers, "Mercado", "mercado", [{"kind": "set_category", "target_id": category}])
    assert apply(client, headers) == {"scanned": 1, "changed": 1}
    assert get_split(client, other, other_tx)["category_id"] is None


def test_preview_lists_only_the_first_items_but_counts_all(client, headers, monkeypatch):
    monkeypatch.setattr(rules_backfill, "PREVIEW_ITEMS", 2)
    account = make_account(client, headers)
    for day in (10, 11, 12):
        create(client, headers, account_id=account, date=f"2026-03-{day}")
    category = make_category(client, headers, "Mercado")
    make_rule(client, headers, "Mercado", "mercado", [{"kind": "set_category", "target_id": category}])
    shown = preview(client, headers)
    assert (shown["changed"], len(shown["items"]), shown["truncated"]) == (3, 2, True)
    assert [item["date"] for item in shown["items"]] == ["2026-03-10", "2026-03-11"]
    # A aplicacao nao e cortada pelo limite da previa
    assert apply(client, headers)["changed"] == 3


def test_too_many_transactions_ask_for_a_smaller_scope(client, headers, monkeypatch):
    monkeypatch.setattr(rules_backfill, "MAX_SCANNED", 2)
    account = make_account(client, headers)
    for day in (10, 11, 12):
        create(client, headers, account_id=account, date=f"2026-03-{day}")
    for url in (PREVIEW, APPLY):
        response = client.post(url, json={}, headers=headers)
        assert (response.status_code, response.json()["code"]) == (422, "rule_run_too_large")
    assert client.post(PREVIEW, json={"date_to": "2026-03-11"}, headers=headers).status_code == 200


def test_exactly_the_limit_is_allowed(client, headers, monkeypatch):
    monkeypatch.setattr(rules_backfill, "MAX_SCANNED", 2)
    account = make_account(client, headers)
    for day in (10, 11):
        create(client, headers, account_id=account, date=f"2026-03-{day}")
    assert client.post(PREVIEW, json={}, headers=headers).status_code == 200


# ---------- Webhooks ----------


def test_apply_notifies_webhooks_once_per_changed_transaction_and_preview_does_not(client, headers, db_session):
    account = make_account(client, headers)
    changed = create(client, headers, account_id=account)
    create(client, headers, account_id=account, description="Padaria", counterparty_name="Padaria")
    other = create(client, headers, account_id=account, description="Outro mercado")
    category = make_category(client, headers, "Mercado")
    make_rule(client, headers, "Mercado", "mercado", [{"kind": "set_category", "target_id": category}])
    webhook = client.post(
        f"{API}/webhooks",
        json={"name": "Casa", "url": "https://hooks.example.com/finance", "events": ["transaction.updated"]},
        headers=headers,
    )
    assert webhook.status_code == 201, webhook.text

    def updated():
        db_session.expire_all()
        return [d for d in db_session.execute(select(WebhookDelivery)).scalars() if d.event == "transaction.updated"]

    preview(client, headers)
    assert updated() == []
    apply(client, headers)
    deliveries = updated()
    assert len(deliveries) == 2
    assert {d.payload["data"]["id"] for d in deliveries} == {changed["id"], other["id"]}
    apply(client, headers)
    assert len(updated()) == 2


def test_a_rule_that_cannot_fill_anything_useful_counts_as_no_change(client, headers):
    account = make_account(client, headers)
    budget = post(client, headers, "budgets", {"name": "Casa", "currency_code": "BRL", "amount": "800.00", "period": "monthly"})
    deposit = create(client, headers, account_id=account, type="deposit", description="Pagamento mercado", counterparty_name="Empresa")
    make_rule(client, headers, "Orcamento", "mercado", [{"kind": "set_budget", "target_id": budget}])
    shown = preview(client, headers)
    assert (shown["scanned"], shown["changed"], shown["items"]) == (1, 0, [])
    assert apply(client, headers) == {"scanned": 1, "changed": 0}
    assert get_split(client, headers, deposit)["budget_id"] is None
