import uuid

import pytest

from tests.conftest import auth_headers, make_user, register

RULES = "/api/v1/rules"
GROUPS = "/api/v1/rule-groups"
API = "/api/v1"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


@pytest.fixture
def other_headers(client, headers, db_session):
    make_user(db_session, email="outra@example.com")
    return auth_headers(client, email="outra@example.com")


def make_category(client, headers, name="Mercado"):
    return client.post(f"{API}/categories", json={"name": name}, headers=headers).json()["id"]


def make_tag(client, headers, name="fixo"):
    return client.post(f"{API}/tags", json={"name": name}, headers=headers).json()["id"]


def make_account(client, headers, name="Nubank"):
    body = {"name": name, "type": "asset", "currency_code": "BRL", "opening_balance": "100.00"}
    return client.post(f"{API}/accounts", json=body, headers=headers).json()["id"]


def make_rule(client, headers, **overrides):
    if "actions" not in overrides:
        category = make_category(client, headers, name=f"Categoria {uuid.uuid4().hex[:8]}")
        overrides["actions"] = [{"kind": "set_category", "target_id": category}]
    body = {
        "name": "Mercado",
        "triggers": [{"field": "description", "op": "contains", "value": "mercado"}],
        **overrides,
    }
    return client.post(RULES, json=body, headers=headers)


def make_group(client, headers, name="Casa", **overrides):
    return client.post(GROUPS, json={"name": name, **overrides}, headers=headers)


# ---------- Criar e ler ----------


def test_create_rule_returns_defaults(client, headers):
    response = make_rule(client, headers)
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Mercado"
    assert body["match_mode"] == "all"
    assert body["stop_processing"] is False
    assert body["active"] is True
    assert body["group_id"] is None
    assert body["position"] == 0
    assert body["triggers"] == [{"field": "description", "op": "contains", "value": "mercado"}]
    assert body["actions"][0]["kind"] == "set_category"
    assert client.get(f"{RULES}/{body['id']}", headers=headers).json() == body


def test_create_requires_login(client):
    assert client.post(RULES, json={}).status_code == 401
    assert client.get(RULES).status_code == 401
    assert client.get(GROUPS).status_code == 401


def test_name_is_trimmed_and_blank_is_refused(client, headers):
    assert make_rule(client, headers, name="  Padaria  ").json()["name"] == "Padaria"
    assert make_rule(client, headers, name="   ").status_code == 422


def test_amount_value_is_normalized(client, headers):
    trigger = {"field": "amount", "op": "greater_than", "value": "100"}
    assert make_rule(client, headers, triggers=[trigger]).json()["triggers"][0]["value"] == "100.00"


@pytest.mark.parametrize(
    "trigger",
    [
        {"field": "amount", "op": "contains", "value": "10"},
        {"field": "description", "op": "greater_than", "value": "10"},
        {"field": "account", "op": "equals", "value": str(uuid.uuid4())},
        {"field": "amount", "op": "equals", "value": "abc"},
        {"field": "amount", "op": "equals", "value": "-1"},
        {"field": "amount", "op": "equals", "value": "1.234"},
        {"field": "amount", "op": "equals", "value": "NaN"},
        {"field": "amount", "op": "equals", "value": "1" + "0" * 16},
        {"field": "account", "op": "is", "value": "nao-e-uuid"},
        {"field": "type", "op": "is", "value": "opening_balance"},
        {"field": "description", "op": "contains", "value": "   "},
        {"field": "banana", "op": "contains", "value": "x"},
    ],
)
def test_invalid_triggers_are_refused(client, headers, trigger):
    assert make_rule(client, headers, triggers=[trigger]).status_code == 422


def test_lists_must_not_be_empty_or_too_long(client, headers):
    one = {"field": "description", "op": "contains", "value": "x"}
    assert make_rule(client, headers, triggers=[]).status_code == 422
    assert make_rule(client, headers, actions=[]).status_code == 422
    assert make_rule(client, headers, triggers=[one] * 11).status_code == 422
    assert make_rule(client, headers, triggers=[one] * 10).status_code == 201


def test_one_category_budget_and_bill_per_rule_but_many_tags(client, headers):
    category = make_category(client, headers)
    twice = [{"kind": "set_category", "target_id": category}] * 2
    assert make_rule(client, headers, actions=twice).status_code == 422
    tag = make_tag(client, headers)
    same_tag = [{"kind": "add_tag", "target_id": tag}] * 2
    assert make_rule(client, headers, actions=same_tag).status_code == 422
    other_tag = make_tag(client, headers, name="viagem")
    ok = [{"kind": "add_tag", "target_id": tag}, {"kind": "add_tag", "target_id": other_tag}]
    assert make_rule(client, headers, actions=ok).status_code == 201


def test_unknown_fields_are_refused(client, headers):
    assert make_rule(client, headers, surprise=1).status_code == 422


# ---------- Alvos que precisam existir e ser do usuario ----------


def test_targets_that_do_not_exist_are_refused(client, headers):
    ghost = str(uuid.uuid4())
    for kind in ("set_category", "set_budget", "set_bill", "add_tag"):
        response = make_rule(client, headers, actions=[{"kind": kind, "target_id": ghost}])
        assert response.status_code == 422, kind
        assert response.json()["code"] == "rule_invalid"
    account = {"field": "account", "op": "is", "value": ghost}
    assert make_rule(client, headers, triggers=[account]).json()["code"] == "rule_invalid"


def test_targets_of_another_user_are_refused(client, headers, other_headers):
    foreign_category = make_category(client, other_headers)
    foreign_tag = make_tag(client, other_headers)
    foreign_account = make_account(client, other_headers)
    for action in (
        {"kind": "set_category", "target_id": foreign_category},
        {"kind": "add_tag", "target_id": foreign_tag},
    ):
        assert make_rule(client, headers, actions=[action]).json()["code"] == "rule_invalid"
    account = {"field": "account", "op": "is", "value": foreign_account}
    assert make_rule(client, headers, triggers=[account]).json()["code"] == "rule_invalid"


def test_own_account_trigger_and_budget_and_bill_actions_are_accepted(client, headers):
    account = make_account(client, headers)
    budget = client.post(
        f"{API}/budgets",
        json={"name": "Casa", "currency_code": "BRL", "amount": "800.00", "period": "monthly"},
        headers=headers,
    ).json()["id"]
    bill = client.post(
        f"{API}/bills",
        json={
            "name": "Netflix",
            "currency_code": "BRL",
            "amount_min": "40.00",
            "amount_max": "60.00",
            "match_text": "netflix",
            "first_due_date": "2026-03-05",
            "frequency": "monthly",
        },
        headers=headers,
    ).json()["id"]
    response = make_rule(
        client,
        headers,
        triggers=[{"field": "account", "op": "is", "value": account}],
        actions=[{"kind": "set_budget", "target_id": budget}, {"kind": "set_bill", "target_id": bill}],
    )
    assert response.status_code == 201


# ---------- Nome, listagem e isolamento ----------


def test_name_is_unique_per_user_ignoring_case(client, headers, other_headers):
    assert make_rule(client, headers, name="Mercado").status_code == 201
    taken = make_rule(client, headers, name="MERCADO")
    assert (taken.status_code, taken.json()["code"]) == (409, "rule_name_taken")
    assert make_rule(client, other_headers, name="Mercado").status_code == 201


def test_other_users_rule_is_404(client, headers, other_headers):
    rule_id = make_rule(client, headers).json()["id"]
    for call in (
        client.get(f"{RULES}/{rule_id}", headers=other_headers),
        client.patch(f"{RULES}/{rule_id}", json={"name": "X"}, headers=other_headers),
        client.delete(f"{RULES}/{rule_id}", headers=other_headers),
    ):
        assert (call.status_code, call.json()["code"]) == (404, "rule_not_found")
    assert client.get(RULES, headers=other_headers).json()["total"] == 0
    assert client.get(f"{RULES}/{rule_id}", headers=headers).status_code == 200


def test_list_filters_by_name_and_active_and_paginates(client, headers):
    make_rule(client, headers, name="Padaria", position=2)
    make_rule(client, headers, name="Mercado", position=1)
    make_rule(client, headers, name="Farmacia", position=3, active=False)
    assert [r["name"] for r in client.get(RULES, headers=headers).json()["items"]] == ["Mercado", "Padaria", "Farmacia"]
    assert [r["name"] for r in client.get(RULES, params={"q": "MERC"}, headers=headers).json()["items"]] == ["Mercado"]
    assert client.get(RULES, params={"q": "%"}, headers=headers).json()["total"] == 0
    inactive = client.get(RULES, params={"active": "false"}, headers=headers).json()
    assert [r["name"] for r in inactive["items"]] == ["Farmacia"]
    page = client.get(RULES, params={"limit": 1, "offset": 1}, headers=headers).json()
    assert (page["total"], [r["name"] for r in page["items"]]) == (3, ["Padaria"])


def test_list_orders_groups_first_then_ungrouped(client, headers):
    late = make_group(client, headers, name="Tarde", position=2).json()["id"]
    early = make_group(client, headers, name="Cedo", position=1).json()["id"]
    make_rule(client, headers, name="Sem grupo", position=0)
    make_rule(client, headers, name="Tarde 1", group_id=late, position=0)
    make_rule(client, headers, name="Cedo 2", group_id=early, position=5)
    make_rule(client, headers, name="Cedo 1", group_id=early, position=1)
    names = [r["name"] for r in client.get(RULES, headers=headers).json()["items"]]
    assert names == ["Cedo 1", "Cedo 2", "Tarde 1", "Sem grupo"]


# ---------- Editar e excluir ----------


def test_patch_changes_only_the_sent_fields(client, headers):
    rule = make_rule(client, headers).json()
    response = client.patch(f"{RULES}/{rule['id']}", json={"name": "Novo", "stop_processing": True}, headers=headers)
    body = response.json()
    assert (body["name"], body["stop_processing"]) == ("Novo", True)
    assert body["triggers"] == rule["triggers"]
    assert body["actions"] == rule["actions"]
    assert body["active"] is True


def test_patch_triggers_alone_keeps_actions_and_revalidates(client, headers):
    rule = make_rule(client, headers).json()
    new = [{"field": "amount", "op": "less_than", "value": "50"}]
    body = client.patch(f"{RULES}/{rule['id']}", json={"triggers": new}, headers=headers).json()
    assert body["triggers"][0]["value"] == "50.00"
    assert body["actions"] == rule["actions"]
    ghost = [{"kind": "set_category", "target_id": str(uuid.uuid4())}]
    refused = client.patch(f"{RULES}/{rule['id']}", json={"actions": ghost}, headers=headers)
    assert (refused.status_code, refused.json()["code"]) == (422, "rule_invalid")
    assert client.get(f"{RULES}/{rule['id']}", headers=headers).json()["actions"] == rule["actions"]


def test_patch_actions_replaces_them_and_keeps_triggers(client, headers):
    rule = make_rule(client, headers).json()
    tag = make_tag(client, headers)
    new = [{"kind": "add_tag", "target_id": tag}]
    body = client.patch(f"{RULES}/{rule['id']}", json={"actions": new}, headers=headers).json()
    assert body["actions"] == new
    assert body["triggers"] == rule["triggers"]
    assert client.get(f"{RULES}/{rule['id']}", headers=headers).json()["actions"] == new


def test_patch_to_a_taken_name_is_409(client, headers):
    make_rule(client, headers, name="Um")
    two = make_rule(client, headers, name="Dois").json()["id"]
    response = client.patch(f"{RULES}/{two}", json={"name": "um"}, headers=headers)
    assert (response.status_code, response.json()["code"]) == (409, "rule_name_taken")
    assert client.get(f"{RULES}/{two}", headers=headers).json()["name"] == "Dois"


def test_patch_null_does_not_clear_required_fields_but_clears_the_group(client, headers):
    group = make_group(client, headers).json()["id"]
    rule = make_rule(client, headers, group_id=group).json()
    body = client.patch(f"{RULES}/{rule['id']}", json={"name": None, "active": None}, headers=headers).json()
    assert (body["name"], body["active"], body["group_id"]) == ("Mercado", True, group)
    body = client.patch(f"{RULES}/{rule['id']}", json={"group_id": None}, headers=headers).json()
    assert body["group_id"] is None


def test_move_rule_to_a_group_of_another_user_is_404(client, headers, other_headers):
    foreign = make_group(client, other_headers).json()["id"]
    assert make_rule(client, headers, group_id=foreign).status_code == 404
    rule_id = make_rule(client, headers).json()["id"]
    response = client.patch(f"{RULES}/{rule_id}", json={"group_id": foreign}, headers=headers)
    assert (response.status_code, response.json()["code"]) == (404, "rule_group_not_found")


def test_delete_rule(client, headers):
    rule_id = make_rule(client, headers).json()["id"]
    assert client.delete(f"{RULES}/{rule_id}", headers=headers).status_code == 204
    assert client.get(f"{RULES}/{rule_id}", headers=headers).status_code == 404
    assert client.delete(f"{RULES}/{rule_id}", headers=headers).status_code == 404


# ---------- Grupos ----------


def test_group_crud_and_ordering(client, headers):
    second = make_group(client, headers, name="Segundo", position=2).json()
    make_group(client, headers, name="Primeiro", position=1)
    assert [g["name"] for g in client.get(GROUPS, headers=headers).json()] == ["Primeiro", "Segundo"]
    body = client.patch(f"{GROUPS}/{second['id']}", json={"name": "Renomeado", "position": 0}, headers=headers).json()
    assert (body["name"], body["position"]) == ("Renomeado", 0)
    assert [g["name"] for g in client.get(GROUPS, headers=headers).json()] == ["Renomeado", "Primeiro"]


def test_group_name_is_unique_per_user(client, headers, other_headers):
    make_group(client, headers, name="Casa")
    taken = make_group(client, headers, name="casa")
    assert (taken.status_code, taken.json()["code"]) == (409, "rule_group_name_taken")
    assert make_group(client, other_headers, name="Casa").status_code == 201
    other = make_group(client, headers, name="Outro").json()["id"]
    renamed = client.patch(f"{GROUPS}/{other}", json={"name": "CASA"}, headers=headers)
    assert renamed.status_code == 409


def test_other_users_group_is_404(client, headers, other_headers):
    group_id = make_group(client, headers).json()["id"]
    for call in (
        client.patch(f"{GROUPS}/{group_id}", json={"name": "X"}, headers=other_headers),
        client.delete(f"{GROUPS}/{group_id}", headers=other_headers),
    ):
        assert (call.status_code, call.json()["code"]) == (404, "rule_group_not_found")
    assert client.get(GROUPS, headers=other_headers).json() == []


def test_deleting_a_group_keeps_its_rules_without_group(client, headers):
    group_id = make_group(client, headers).json()["id"]
    rule_id = make_rule(client, headers, group_id=group_id).json()["id"]
    assert client.delete(f"{GROUPS}/{group_id}", headers=headers).status_code == 204
    rule = client.get(f"{RULES}/{rule_id}", headers=headers).json()
    assert rule["group_id"] is None


def test_deleting_a_category_does_not_break_listing_rules(client, headers):
    category = make_category(client, headers)
    rule_id = make_rule(
        client, headers, actions=[{"kind": "set_category", "target_id": category}]
    ).json()["id"]
    assert client.delete(f"{API}/categories/{category}", headers=headers).status_code in (204, 409)
    assert client.get(f"{RULES}/{rule_id}", headers=headers).status_code == 200
