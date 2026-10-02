import uuid

import pytest

from tests.conftest import auth_headers, make_user, register

API = "/api/v1"
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


def make_category(client, headers, name):
    return post(client, headers, "categories", {"name": name})


def make_tag(client, headers, name):
    return post(client, headers, "tags", {"name": name})


def make_budget(client, headers, name="Casa", currency="BRL"):
    return post(
        client, headers, "budgets",
        {"name": name, "currency_code": currency, "amount": "800.00", "period": "monthly"},
    )


def make_bill(client, headers, name="Netflix"):
    return post(
        client, headers, "bills",
        {
            "name": name,
            "currency_code": "BRL",
            "amount_min": "40.00",
            "amount_max": "60.00",
            "match_text": "zzz-nunca-casa",
            "first_due_date": "2026-03-05",
            "frequency": "monthly",
        },
    )


def make_rule(client, headers, name, triggers, actions, **extra):
    body = {"name": name, "triggers": triggers, "actions": actions, **extra}
    response = client.post(f"{API}/rules", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def when_description_has(text):
    return [{"field": "description", "op": "contains", "value": text}]


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


def create(client, headers, *splits):
    response = client.post(TX, json={"splits": list(splits)}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def first_split(transaction):
    return transaction["splits"][0]


# ---------- Preenchimento ao criar ----------


def test_rule_fills_category_tag_budget_and_bill(client, headers):
    account = make_account(client, headers)
    category = make_category(client, headers, "Mercado")
    tag = make_tag(client, headers, "casa")
    budget = make_budget(client, headers)
    bill = make_bill(client, headers)
    make_rule(
        client, headers, "Mercado", when_description_has("mercado"),
        [
            {"kind": "set_category", "target_id": category},
            {"kind": "add_tag", "target_id": tag},
            {"kind": "set_budget", "target_id": budget},
            {"kind": "set_bill", "target_id": bill},
        ],
    )
    saved = first_split(create(client, headers, split(account)))
    assert saved["category_id"] == category
    assert saved["tag_ids"] == [tag]
    assert saved["budget_id"] == budget
    assert saved["bill_id"] == bill


def test_without_a_matching_rule_nothing_changes(client, headers):
    account = make_account(client, headers)
    category = make_category(client, headers, "Mercado")
    make_rule(client, headers, "Farmacia", when_description_has("farmacia"), [{"kind": "set_category", "target_id": category}])
    saved = first_split(create(client, headers, split(account)))
    assert (saved["category_id"], saved["budget_id"], saved["bill_id"], saved["tag_ids"]) == (None, None, None, [])


def test_what_the_person_chose_is_never_overwritten(client, headers):
    account = make_account(client, headers)
    ruled = make_category(client, headers, "Mercado")
    chosen = make_category(client, headers, "Festa")
    ruled_budget = make_budget(client, headers, "Casa")
    chosen_budget = make_budget(client, headers, "Lazer")
    make_rule(
        client, headers, "Mercado", when_description_has("mercado"),
        [{"kind": "set_category", "target_id": ruled}, {"kind": "set_budget", "target_id": ruled_budget}],
    )
    saved = first_split(
        create(client, headers, split(account, category_id=chosen, budget_id=chosen_budget))
    )
    assert saved["category_id"] == chosen
    assert saved["budget_id"] == chosen_budget


def test_each_field_is_filled_on_its_own(client, headers):
    account = make_account(client, headers)
    ruled = make_category(client, headers, "Mercado")
    chosen = make_category(client, headers, "Festa")
    budget = make_budget(client, headers)
    make_rule(
        client, headers, "Mercado", when_description_has("mercado"),
        [{"kind": "set_category", "target_id": ruled}, {"kind": "set_budget", "target_id": budget}],
    )
    saved = first_split(create(client, headers, split(account, category_id=chosen)))
    assert saved["category_id"] == chosen
    assert saved["budget_id"] == budget


def test_tags_are_added_to_the_ones_chosen_without_duplicates(client, headers):
    account = make_account(client, headers)
    chosen = make_tag(client, headers, "viagem")
    added = make_tag(client, headers, "casa")
    make_rule(
        client, headers, "Mercado", when_description_has("mercado"),
        [{"kind": "add_tag", "target_id": chosen}, {"kind": "add_tag", "target_id": added}],
    )
    saved = first_split(create(client, headers, split(account, tag_ids=[chosen])))
    assert saved["tag_ids"] == [chosen, added]


def test_explicit_null_bill_means_do_not_link(client, headers):
    account = make_account(client, headers)
    bill = make_bill(client, headers)
    make_rule(client, headers, "Mercado", when_description_has("mercado"), [{"kind": "set_bill", "target_id": bill}])
    assert first_split(create(client, headers, split(account, bill_id=None)))["bill_id"] is None
    assert first_split(create(client, headers, split(account)))["bill_id"] == bill


def test_rule_bill_wins_over_nothing_but_not_over_a_chosen_bill(client, headers):
    account = make_account(client, headers)
    ruled = make_bill(client, headers, "Netflix")
    chosen = make_bill(client, headers, "Spotify")
    make_rule(client, headers, "Mercado", when_description_has("mercado"), [{"kind": "set_bill", "target_id": ruled}])
    assert first_split(create(client, headers, split(account, bill_id=chosen)))["bill_id"] == chosen


# ---------- Gatilhos ----------


def test_triggers_by_counterparty_amount_account_and_type(client, headers):
    first = make_account(client, headers, "Nubank")
    second = make_account(client, headers, "Itau")
    category = make_category(client, headers, "Mercado")
    action = [{"kind": "set_category", "target_id": category}]
    make_rule(client, headers, "Por contraparte", [{"field": "counterparty", "op": "starts_with", "value": "super"}], action)
    saved = first_split(create(client, headers, split(first, description="Outra coisa")))
    assert saved["category_id"] == category

    other_category = make_category(client, headers, "Grande")
    make_rule(
        client, headers, "Grande e do Itau",
        [
            {"field": "amount", "op": "greater_than", "value": "1000"},
            {"field": "account", "op": "is", "value": second},
            {"field": "type", "op": "is", "value": "withdrawal"},
        ],
        [{"kind": "set_category", "target_id": other_category}],
        position=0,
    )
    big_other = first_split(create(client, headers, split(second, description="Sem relacao", counterparty_name="Loja", amount="1500.00")))
    assert big_other["category_id"] == other_category
    big_first_account = first_split(create(client, headers, split(first, description="Sem relacao", counterparty_name="Loja", amount="1500.00")))
    assert big_first_account["category_id"] is None


def test_counterparty_trigger_uses_the_name_of_an_existing_counterparty_account(client, headers):
    account = make_account(client, headers)
    category = make_category(client, headers, "Mercado")
    make_rule(
        client, headers, "Por contraparte", [{"field": "counterparty", "op": "equals", "value": "padaria do ze"}],
        [{"kind": "set_category", "target_id": category}],
    )
    first = create(client, headers, split(account, counterparty_name="Padaria do Ze", description="Pao"))
    counterparty = first_split(first)["source_account_id"]
    counterparty = first_split(first)["destination_account_id"]
    by_account = split(account, description="Outro pao")
    del by_account["counterparty_name"]
    by_account["counterparty_account_id"] = counterparty
    assert first_split(create(client, headers, by_account))["category_id"] == category


def test_any_mode_needs_only_one_trigger_and_all_mode_needs_every_one(client, headers):
    account = make_account(client, headers)
    category = make_category(client, headers, "Mercado")
    triggers = [
        {"field": "description", "op": "contains", "value": "farmacia"},
        {"field": "amount", "op": "equals", "value": "120.50"},
    ]
    action = [{"kind": "set_category", "target_id": category}]
    rule_id = make_rule(client, headers, "Qualquer", triggers, action, match_mode="any")
    assert first_split(create(client, headers, split(account)))["category_id"] == category
    client.patch(f"{API}/rules/{rule_id}", json={"match_mode": "all"}, headers=headers)
    assert first_split(create(client, headers, split(account)))["category_id"] is None


def test_rule_on_a_deposit_matches_the_revenue_side(client, headers):
    account = make_account(client, headers)
    category = make_category(client, headers, "Salario")
    make_rule(
        client, headers, "Salario", [{"field": "counterparty", "op": "contains", "value": "empresa"}],
        [{"kind": "set_category", "target_id": category}],
    )
    deposit = split(account, type="deposit", description="Pagamento", counterparty_name="Empresa X", amount="3000.00")
    assert first_split(create(client, headers, deposit))["category_id"] == category


# ---------- Ordem, grupos e parada ----------


def test_first_rule_by_group_and_position_wins_and_stop_blocks_the_rest(client, headers):
    account = make_account(client, headers)
    first_category = make_category(client, headers, "Primeira")
    second_category = make_category(client, headers, "Segunda")
    budget = make_budget(client, headers)
    late = client.post(f"{API}/rule-groups", json={"name": "Tarde", "position": 2}, headers=headers).json()["id"]
    early = client.post(f"{API}/rule-groups", json={"name": "Cedo", "position": 1}, headers=headers).json()["id"]
    make_rule(
        client, headers, "Tarde", when_description_has("mercado"),
        [{"kind": "set_category", "target_id": second_category}, {"kind": "set_budget", "target_id": budget}],
        group_id=late,
    )
    make_rule(
        client, headers, "Cedo", when_description_has("mercado"),
        [{"kind": "set_category", "target_id": first_category}],
        group_id=early, stop_processing=True,
    )
    saved = first_split(create(client, headers, split(account)))
    assert saved["category_id"] == first_category
    assert saved["budget_id"] is None


def test_without_stop_a_later_rule_fills_what_is_still_empty(client, headers):
    account = make_account(client, headers)
    first_category = make_category(client, headers, "Primeira")
    second_category = make_category(client, headers, "Segunda")
    budget = make_budget(client, headers)
    make_rule(client, headers, "Um", when_description_has("mercado"), [{"kind": "set_category", "target_id": first_category}], position=0)
    make_rule(
        client, headers, "Dois", when_description_has("mercado"),
        [{"kind": "set_category", "target_id": second_category}, {"kind": "set_budget", "target_id": budget}],
        position=1,
    )
    saved = first_split(create(client, headers, split(account)))
    assert (saved["category_id"], saved["budget_id"]) == (first_category, budget)


def test_inactive_rule_is_ignored(client, headers):
    account = make_account(client, headers)
    category = make_category(client, headers, "Mercado")
    rule_id = make_rule(client, headers, "Mercado", when_description_has("mercado"), [{"kind": "set_category", "target_id": category}])
    client.patch(f"{API}/rules/{rule_id}", json={"active": False}, headers=headers)
    assert first_split(create(client, headers, split(account)))["category_id"] is None
    client.patch(f"{API}/rules/{rule_id}", json={"active": True}, headers=headers)
    assert first_split(create(client, headers, split(account)))["category_id"] == category


def test_rules_of_another_user_do_not_apply(client, headers, db_session):
    account = make_account(client, headers)
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    other_category = make_category(client, other, "Mercado")
    make_rule(client, other, "Mercado", when_description_has("mercado"), [{"kind": "set_category", "target_id": other_category}])
    assert first_split(create(client, headers, split(account)))["category_id"] is None


def test_stop_of_another_users_rule_does_not_block_my_rules(client, headers, db_session):
    account = make_account(client, headers)
    own = make_category(client, headers, "Minha")
    make_rule(client, headers, "Minha", when_description_has("mercado"), [{"kind": "set_category", "target_id": own}], position=5)
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    foreign = make_category(client, other, "Dela")
    make_rule(
        client, other, "Dela", when_description_has("mercado"),
        [{"kind": "set_category", "target_id": foreign}], position=0, stop_processing=True,
    )
    assert first_split(create(client, headers, split(account)))["category_id"] == own


def test_a_group_runs_before_rules_without_group(client, headers):
    account = make_account(client, headers)
    grouped_category = make_category(client, headers, "Do grupo")
    loose_category = make_category(client, headers, "Solta")
    group = client.post(f"{API}/rule-groups", json={"name": "Casa", "position": 9}, headers=headers).json()["id"]
    make_rule(client, headers, "Solta", when_description_has("mercado"), [{"kind": "set_category", "target_id": loose_category}], position=0)
    make_rule(
        client, headers, "Do grupo", when_description_has("mercado"),
        [{"kind": "set_category", "target_id": grouped_category}], group_id=group, position=0,
    )
    assert first_split(create(client, headers, split(account)))["category_id"] == grouped_category


def test_position_orders_rules_inside_a_group(client, headers):
    account = make_account(client, headers)
    early = make_category(client, headers, "Primeira")
    late = make_category(client, headers, "Segunda")
    group = client.post(f"{API}/rule-groups", json={"name": "Casa"}, headers=headers).json()["id"]
    # Criada primeiro, mas com posicao maior: roda depois
    make_rule(client, headers, "Segunda", when_description_has("mercado"), [{"kind": "set_category", "target_id": late}], group_id=group, position=2)
    make_rule(client, headers, "Primeira", when_description_has("mercado"), [{"kind": "set_category", "target_id": early}], group_id=group, position=1)
    assert first_split(create(client, headers, split(account)))["category_id"] == early


def test_tag_of_another_user_in_a_stale_rule_is_not_applied(client, headers, db_session):
    account = make_account(client, headers)
    own = make_tag(client, headers, "minha")
    rule_id = make_rule(client, headers, "Mercado", when_description_has("mercado"), [{"kind": "add_tag", "target_id": own}])
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    foreign = make_tag(client, other, "dela")
    from app.models.rule import Rule

    rule = db_session.get(Rule, uuid.UUID(rule_id))
    rule.actions = [{"kind": "add_tag", "target_id": foreign}]
    db_session.commit()
    assert first_split(create(client, headers, split(account)))["tag_ids"] == []


def test_each_split_of_a_group_is_decided_on_its_own(client, headers):
    account = make_account(client, headers)
    category = make_category(client, headers, "Mercado")
    make_rule(client, headers, "Mercado", when_description_has("mercado"), [{"kind": "set_category", "target_id": category}])
    saved = create(client, headers, split(account), split(account, description="Padaria", amount="10.00"))
    assert [s["category_id"] for s in saved["splits"]] == [category, None]


# ---------- Alvos que nao servem: a regra nunca derruba o lancamento ----------


def test_budget_on_a_deposit_is_skipped_but_the_rest_is_filled(client, headers):
    account = make_account(client, headers)
    category = make_category(client, headers, "Salario")
    budget = make_budget(client, headers)
    make_rule(
        client, headers, "Entrada", [{"field": "type", "op": "is", "value": "deposit"}],
        [{"kind": "set_budget", "target_id": budget}, {"kind": "set_category", "target_id": category}],
    )
    saved = first_split(create(client, headers, split(account, type="deposit", counterparty_name="Empresa")))
    assert saved["budget_id"] is None
    assert saved["category_id"] == category


def test_budget_in_another_currency_is_skipped(client, headers):
    account = make_account(client, headers)
    budget = post(
        client, headers, "budgets",
        {"name": "Dolar", "currency_code": "USD", "amount": "100.00", "period": "monthly"},
    )
    make_rule(client, headers, "Mercado", when_description_has("mercado"), [{"kind": "set_budget", "target_id": budget}])
    assert first_split(create(client, headers, split(account)))["budget_id"] is None


def test_bill_on_a_deposit_is_skipped(client, headers):
    account = make_account(client, headers)
    bill = make_bill(client, headers)
    make_rule(client, headers, "Entrada", [{"field": "type", "op": "is", "value": "deposit"}], [{"kind": "set_bill", "target_id": bill}])
    assert first_split(create(client, headers, split(account, type="deposit", counterparty_name="Empresa")))["bill_id"] is None


def test_deleted_targets_are_ignored(client, headers):
    account = make_account(client, headers)
    category = make_category(client, headers, "Velha")
    tag = make_tag(client, headers, "velha")
    budget = make_budget(client, headers, "Velho")
    bill = make_bill(client, headers, "Velha")
    make_rule(
        client, headers, "Mercado", when_description_has("mercado"),
        [
            {"kind": "set_category", "target_id": category},
            {"kind": "add_tag", "target_id": tag},
            {"kind": "set_budget", "target_id": budget},
            {"kind": "set_bill", "target_id": bill},
        ],
    )
    for path, item in (("categories", category), ("tags", tag), ("budgets", budget), ("bills", bill)):
        assert client.delete(f"{API}/{path}/{item}", headers=headers).status_code == 204
    response = client.post(TX, json={"splits": [split(account)]}, headers=headers)
    assert response.status_code == 201
    saved = first_split(response.json())
    assert (saved["category_id"], saved["budget_id"], saved["bill_id"], saved["tag_ids"]) == (None, None, None, [])


def test_category_of_another_user_in_a_stale_rule_is_not_applied(client, headers, db_session):
    account = make_account(client, headers)
    own = make_category(client, headers, "Minha")
    rule_id = make_rule(client, headers, "Mercado", when_description_has("mercado"), [{"kind": "set_category", "target_id": own}])
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    foreign = make_category(client, other, "Dela")
    from app.models.rule import Rule

    rule = db_session.get(Rule, uuid.UUID(rule_id))
    rule.actions = [{"kind": "set_category", "target_id": foreign}]
    db_session.commit()
    assert first_split(create(client, headers, split(account)))["category_id"] is None


# ---------- Edicao ----------


def test_editing_fills_only_what_is_still_empty(client, headers):
    account = make_account(client, headers)
    chosen = make_category(client, headers, "Festa")
    ruled = make_category(client, headers, "Mercado")
    budget = make_budget(client, headers)
    created = create(client, headers, split(account, description="Sem relacao", category_id=chosen))
    make_rule(
        client, headers, "Mercado", when_description_has("mercado"),
        [{"kind": "set_category", "target_id": ruled}, {"kind": "set_budget", "target_id": budget}],
    )
    body = {"splits": [split(account, category_id=chosen)]}
    response = client.put(f"{TX}/{created['id']}", json=body, headers=headers)
    assert response.status_code == 200, response.text
    saved = first_split(response.json())
    assert saved["category_id"] == chosen
    assert saved["budget_id"] == budget


def test_editing_a_split_without_choices_gets_the_rule(client, headers):
    account = make_account(client, headers)
    category = make_category(client, headers, "Mercado")
    created = create(client, headers, split(account, description="Sem relacao"))
    make_rule(client, headers, "Mercado", when_description_has("mercado"), [{"kind": "set_category", "target_id": category}])
    response = client.put(f"{TX}/{created['id']}", json={"splits": [split(account)]}, headers=headers)
    assert first_split(response.json())["category_id"] == category


# ---------- Recorrentes ----------


def test_recurring_transactions_also_go_through_the_rules(client, headers):
    from datetime import timedelta

    from app.core import clock

    account = make_account(client, headers)
    category = make_category(client, headers, "Mercado")
    make_rule(client, headers, "Mercado", when_description_has("mercado"), [{"kind": "set_category", "target_id": category}])
    start = clock.today() - timedelta(days=1)
    body = {
        "name": "Mercado mensal",
        "frequency": "monthly",
        "first_date": start.isoformat(),
        "template": {"splits": [split(account, date=start.isoformat())]},
    }
    response = client.post(f"{API}/recurrences", json=body, headers=headers)
    assert response.status_code == 201, response.text
    items = client.get(TX, headers=headers).json()["items"]
    assert items, "a recorrente deveria ter criado a ocorrencia de ontem"
    assert all(first_split(item)["category_id"] == category for item in items)
