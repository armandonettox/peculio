import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.core import clock
from app.models.saved_report import ReportChart, ReportGroupBy, ReportMeasure
from app.schemas.saved_report import config_error
from tests.conftest import auth_headers, make_user, register

API = "/api/v1"
# Fixo de proposito: se o teto mudar, este teste precisa ser mudado de mao
LIMIT = 30
SAVED = f"{API}/reports/saved"
REPORTS = f"{API}/reports"
TX = f"{API}/transactions"


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def body(**overrides):
    return {
        "name": "Gastos do mes",
        "group_by": "category",
        "chart": "donut",
        "measure": "expense",
        "period": "this-month",
        **overrides,
    }


def save(client, headers, **overrides):
    response = client.post(SAVED, json=body(**overrides), headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def other_user(client, db_session, email="outra@example.com"):
    make_user(db_session, email=email)
    return auth_headers(client, email=email)


def make_label(client, headers, kind, name, category_kind="expense"):
    extra = {"kind": category_kind} if kind == "categories" else {}
    response = client.post(f"{API}/{kind}", json={"name": name, **extra}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


# ---------- Regras da combinacao (puras) ----------


@pytest.mark.parametrize(
    ("group_by", "chart", "measure", "ok"),
    [
        ("month", "line", "expense", True),
        ("month", "line", "net", True),
        ("month", "bar", "net", True),
        ("month", "table", "income", True),
        ("category", "line", "expense", False),
        ("account", "line", "income", False),
        ("month", "donut", "expense", False),
        ("category", "donut", "net", False),
        ("category", "donut", "expense", True),
        ("counterparty", "donut", "income", True),
        ("tag", "bar", "net", True),
        ("budget", "table", "net", True),
    ],
)
def test_chart_rules(group_by, chart, measure, ok):
    error = config_error(ReportGroupBy(group_by), ReportChart(chart), ReportMeasure(measure))
    assert (error is None) is ok


def test_chart_rules_explain_themselves():
    assert "linha" in config_error(ReportGroupBy.category, ReportChart.line, ReportMeasure.expense)
    assert "mes" in config_error(ReportGroupBy.month, ReportChart.donut, ReportMeasure.expense)
    assert "saldo" in config_error(ReportGroupBy.category, ReportChart.donut, ReportMeasure.net)


# ---------- Salvar, listar, abrir ----------


def test_requires_login(client):
    assert client.get(SAVED).status_code == 401
    assert client.post(SAVED, json=body()).status_code == 401


def test_save_returns_what_was_sent_with_an_id(client, headers):
    created = save(client, headers)
    assert created["name"] == "Gastos do mes"
    assert (created["group_by"], created["chart"], created["measure"], created["period"]) == ("category", "donut", "expense", "this-month")
    assert created["date_from"] is None and created["date_to"] is None
    assert created["account_id"] is None and created["category_id"] is None
    assert uuid.UUID(created["id"])
    assert created["created_at"] and created["updated_at"]


def test_save_keeps_a_fixed_period_and_the_filters(client, headers):
    account = client.post(f"{API}/accounts", json={"name": "Nubank", "type": "asset", "currency_code": "BRL"}, headers=headers).json()["id"]
    category = make_label(client, headers, "categories", "Mercado")
    tag = make_label(client, headers, "tags", "viagem")
    budget = client.post(f"{API}/budgets", json={"name": "Casa", "currency_code": "BRL", "amount": "100.00", "period": "monthly"}, headers=headers).json()["id"]
    created = save(
        client, headers, period="fixed", date_from="2026-01-01", date_to="2026-03-31",
        account_id=account, category_id=category, tag_id=tag, budget_id=budget, group_by="month", chart="line",
    )
    assert (created["date_from"], created["date_to"]) == ("2026-01-01", "2026-03-31")
    assert (created["account_id"], created["category_id"], created["tag_id"], created["budget_id"]) == (account, category, tag, budget)
    assert client.get(f"{SAVED}/{created['id']}", headers=headers).json() == created


def test_list_is_ordered_by_name_ignoring_case(client, headers):
    for name in ["banana", "Cereja", "abacate"]:
        save(client, headers, name=name)
    assert [item["name"] for item in client.get(SAVED, headers=headers).json()] == ["abacate", "banana", "Cereja"]


def test_list_starts_empty(client, headers):
    assert client.get(SAVED, headers=headers).json() == []


def test_name_is_trimmed(client, headers):
    assert save(client, headers, name="  Mensal  ")["name"] == "Mensal"


# ---------- Editar e excluir ----------


def test_update_replaces_everything(client, headers):
    created = save(client, headers)
    changed = body(name="Evolucao", group_by="month", chart="line", measure="net", period="last-12-months")
    response = client.put(f"{SAVED}/{created['id']}", json=changed, headers=headers)
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["id"] == created["id"]
    assert (updated["name"], updated["group_by"], updated["chart"], updated["measure"], updated["period"]) == (
        "Evolucao", "month", "line", "net", "last-12-months",
    )
    assert updated["created_at"] == created["created_at"]
    assert client.get(f"{SAVED}/{created['id']}", headers=headers).json() == updated


def test_update_can_clear_a_filter_and_the_fixed_dates(client, headers):
    category = make_label(client, headers, "categories", "Mercado")
    created = save(client, headers, period="fixed", date_from="2026-01-01", date_to="2026-01-31", category_id=category)
    updated = client.put(f"{SAVED}/{created['id']}", json=body(period="this-year"), headers=headers).json()
    assert updated["category_id"] is None
    assert updated["date_from"] is None and updated["date_to"] is None


def test_delete_removes_only_that_report(client, headers):
    first = save(client, headers, name="Um")
    second = save(client, headers, name="Dois")
    assert client.delete(f"{SAVED}/{first['id']}", headers=headers).status_code == 204
    assert client.get(f"{SAVED}/{first['id']}", headers=headers).status_code == 404
    assert [item["id"] for item in client.get(SAVED, headers=headers).json()] == [second["id"]]


def test_unknown_id_is_404(client, headers):
    missing = str(uuid.uuid4())
    for call in (
        lambda: client.get(f"{SAVED}/{missing}", headers=headers),
        lambda: client.put(f"{SAVED}/{missing}", json=body(), headers=headers),
        lambda: client.delete(f"{SAVED}/{missing}", headers=headers),
    ):
        response = call()
        assert response.status_code == 404
        assert response.json()["code"] == "saved_report_not_found"


# ---------- Nome ----------


def test_name_must_be_unique_ignoring_case(client, headers):
    save(client, headers, name="Gastos")
    response = client.post(SAVED, json=body(name="gastos"), headers=headers)
    assert response.status_code == 409
    assert response.json()["code"] == "saved_report_name_taken"


def test_rename_to_another_name_in_use_is_refused_but_to_its_own_is_fine(client, headers):
    first = save(client, headers, name="Um")
    save(client, headers, name="Dois")
    taken = client.put(f"{SAVED}/{first['id']}", json=body(name="DOIS"), headers=headers)
    assert taken.status_code == 409
    assert taken.json()["code"] == "saved_report_name_taken"
    same = client.put(f"{SAVED}/{first['id']}", json=body(name="UM", chart="bar"), headers=headers)
    assert same.status_code == 200
    assert same.json()["name"] == "UM"


def test_two_people_can_use_the_same_name(client, db_session, headers):
    save(client, headers, name="Gastos")
    theirs = other_user(client, db_session)
    assert client.post(SAVED, json=body(name="Gastos"), headers=theirs).status_code == 201


# ---------- Limite ----------


def test_limit_of_saved_reports(client, headers):
    for index in range(LIMIT):
        save(client, headers, name=f"Relatorio {index}")
    response = client.post(SAVED, json=body(name="Mais um"), headers=headers)
    assert response.status_code == 409
    assert response.json()["code"] == "saved_report_limit_reached"
    # Excluir um libera espaco
    first = client.get(SAVED, headers=headers).json()[0]
    assert client.delete(f"{SAVED}/{first['id']}", headers=headers).status_code == 204
    assert client.post(SAVED, json=body(name="Mais um"), headers=headers).status_code == 201


def test_the_limit_is_per_person(client, db_session, headers):
    for index in range(LIMIT):
        save(client, headers, name=f"Relatorio {index}")
    theirs = other_user(client, db_session)
    assert client.post(SAVED, json=body(), headers=theirs).status_code == 201


# ---------- Pedido invalido ----------


@pytest.mark.parametrize(
    ("overrides", "text"),
    [
        ({"name": ""}, "name"),
        ({"name": "   "}, "Informe o nome"),
        ({"name": "x" * 81}, "name"),
        ({"period": "fixed"}, "duas datas"),
        ({"period": "fixed", "date_from": "2026-01-01"}, "duas datas"),
        ({"period": "fixed", "date_from": "2026-02-01", "date_to": "2026-01-01"}, "depois da data final"),
        ({"date_from": "2026-01-01"}, "so valem no periodo fixo"),
        ({"date_to": "2026-01-01", "period": "this-year"}, "so valem no periodo fixo"),
        ({"group_by": "category", "chart": "line"}, "linha"),
        ({"group_by": "month", "chart": "donut"}, "rosca"),
        ({"chart": "donut", "measure": "net"}, "saldo"),
        ({"group_by": "inventado"}, "group_by"),
        ({"chart": "inventado"}, "chart"),
        ({"measure": "inventado"}, "measure"),
        ({"period": "inventado"}, "period"),
        ({"extra": 1}, "extra"),
    ],
)
def test_invalid_requests_are_422(client, headers, overrides, text):
    response = client.post(SAVED, json=body(**overrides), headers=headers)
    assert response.status_code == 422, response.text
    assert text in response.text


def test_a_fixed_period_on_one_day_is_fine(client, headers):
    created = save(client, headers, period="fixed", date_from="2026-03-10", date_to="2026-03-10")
    assert created["date_from"] == created["date_to"] == "2026-03-10"


def test_update_is_validated_like_create(client, headers):
    created = save(client, headers)
    response = client.put(f"{SAVED}/{created['id']}", json=body(chart="line"), headers=headers)
    assert response.status_code == 422


# ---------- Filtros e donos ----------


def test_filters_of_another_person_are_refused(client, db_session, headers):
    theirs = other_user(client, db_session)
    category = make_label(client, theirs, "categories", "Dela")
    tag = make_label(client, theirs, "tags", "dela")
    account = client.post(f"{API}/accounts", json={"name": "Dela", "type": "asset", "currency_code": "BRL"}, headers=theirs).json()["id"]
    budget = client.post(f"{API}/budgets", json={"name": "Dela", "currency_code": "BRL", "amount": "100.00", "period": "monthly"}, headers=theirs).json()["id"]
    for field, value, code in [
        ("category_id", category, "category_not_found"),
        ("tag_id", tag, "tag_not_found"),
        ("account_id", account, "account_not_found"),
        ("budget_id", budget, "budget_not_found"),
    ]:
        response = client.post(SAVED, json=body(**{field: value}), headers=headers)
        assert response.status_code == 404, (field, response.text)
        assert response.json()["code"] == code
    assert client.get(SAVED, headers=headers).json() == []


def test_update_also_checks_the_filters(client, db_session, headers):
    created = save(client, headers)
    theirs = other_user(client, db_session)
    foreign = make_label(client, theirs, "categories", "Dela")
    response = client.put(f"{SAVED}/{created['id']}", json=body(category_id=foreign), headers=headers)
    assert response.status_code == 404
    assert client.get(f"{SAVED}/{created['id']}", headers=headers).json()["category_id"] is None


def test_reports_of_another_person_do_not_exist_for_me(client, db_session, headers):
    mine = save(client, headers)
    theirs = other_user(client, db_session)
    assert client.get(SAVED, headers=theirs).json() == []
    assert client.get(f"{SAVED}/{mine['id']}", headers=theirs).status_code == 404
    assert client.put(f"{SAVED}/{mine['id']}", json=body(name="Roubado"), headers=theirs).status_code == 404
    assert client.delete(f"{SAVED}/{mine['id']}", headers=theirs).status_code == 404
    assert client.get(f"{SAVED}/{mine['id']}", headers=headers).json()["name"] == "Gastos do mes"


def test_a_deleted_category_leaves_the_report_pointing_at_it_and_running_it_says_so(client, headers):
    category = make_label(client, headers, "categories", "Mercado")
    created = save(client, headers, category_id=category)
    assert client.delete(f"{API}/categories/{category}", headers=headers).status_code in (200, 204)
    # O relatorio continua guardado, com o filtro como estava: nao vira "tudo" em silencio
    assert client.get(f"{SAVED}/{created['id']}", headers=headers).json()["category_id"] == category
    response = client.get(f"{REPORTS}/by-category", params={"period": "this-month", "category_id": category}, headers=headers)
    assert response.status_code == 404
    assert response.json()["code"] == "category_not_found"


# ---------- Periodos prontos novos ----------


@pytest.mark.parametrize(
    ("today", "preset", "expected"),
    [
        (date(2026, 3, 10), "last-3-months", ("2026-01-01", "2026-03-31")),
        (date(2026, 2, 28), "last-3-months", ("2025-12-01", "2026-02-28")),
        (date(2026, 1, 1), "last-3-months", ("2025-11-01", "2026-01-31")),
        (date(2028, 2, 29), "last-3-months", ("2027-12-01", "2028-02-29")),
        (date(2026, 12, 31), "last-3-months", ("2026-10-01", "2026-12-31")),
        (date(2026, 3, 10), "last-12-months", ("2025-04-01", "2026-03-31")),
        (date(2026, 1, 31), "last-12-months", ("2025-02-01", "2026-01-31")),
        (date(2026, 12, 15), "last-12-months", ("2026-01-01", "2026-12-31")),
        (date(2028, 2, 10), "last-12-months", ("2027-03-01", "2028-02-29")),
    ],
)
def test_the_new_presets_count_the_current_month_whole(client, headers, monkeypatch, today, preset, expected):
    monkeypatch.setattr(clock, "today", lambda now=None: today)
    for endpoint in ("summary", "by-category", "by-tag", "by-budget", "by-account", "by-counterparty"):
        body_ = client.get(f"{REPORTS}/{endpoint}", params={"period": preset}, headers=headers).json()
        assert (body_["date_from"], body_["date_to"]) == expected, endpoint


def test_the_new_presets_work_on_the_monthly_chart(client, headers, monkeypatch):
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 5, 20))
    result = client.get(f"{REPORTS}/monthly", params={"period": "last-3-months"}, headers=headers).json()
    assert (result["date_from"], result["date_to"]) == ("2026-03-01", "2026-05-31")


def test_an_unknown_preset_is_422(client, headers):
    assert client.get(f"{REPORTS}/summary", params={"period": "last-5-months"}, headers=headers).status_code == 422


# ---------- Agrupar por contraparte ----------


def seed_counterparties(client, headers):
    account = client.post(f"{API}/accounts", json={"name": "Nubank", "type": "asset", "currency_code": "BRL", "opening_balance": "5000"}, headers=headers).json()["id"]
    category = make_label(client, headers, "categories", "Mercado")

    def add(kind, amount, who, on="2026-03-10", **extra):
        split = {
            "type": kind, "date": on, "description": f"{who} {amount}", "amount": amount, "currency_code": "BRL",
            "account_id": account, "counterparty_name": who, **extra,
        }
        response = client.post(TX, json={"splits": [split]}, headers=headers)
        assert response.status_code == 201, response.text

    add("withdrawal", "50.00", "Mercado Central", category_id=category)
    add("withdrawal", "30.00", "Mercado Central")
    add("withdrawal", "20.00", "Padaria")
    add("deposit", "1000.00", "Empresa")
    add("withdrawal", "999.00", "Fora do periodo", on="2026-04-10")
    return account, category


def rows_of(response):
    assert response.status_code == 200, response.text
    block = next(item for item in response.json()["currencies"] if item["currency_code"] == "BRL")
    return {row["name"]: row for row in block["rows"]}, [row["name"] for row in block["rows"]]


def test_by_counterparty_groups_by_the_other_side(client, headers):
    seed_counterparties(client, headers)
    rows, order = rows_of(client.get(f"{REPORTS}/by-counterparty", params={"date_from": "2026-03-01", "date_to": "2026-03-31"}, headers=headers))
    assert order == ["Mercado Central", "Padaria", "Empresa"]
    assert (Decimal(rows["Mercado Central"]["expense"]), Decimal(rows["Mercado Central"]["income"]), rows["Mercado Central"]["count"]) == (Decimal("80.00"), Decimal("0.00"), 2)
    assert (Decimal(rows["Padaria"]["expense"]), rows["Padaria"]["count"]) == (Decimal("20.00"), 1)
    assert (Decimal(rows["Empresa"]["income"]), Decimal(rows["Empresa"]["expense"]), Decimal(rows["Empresa"]["net"])) == (Decimal("1000.00"), Decimal("0.00"), Decimal("1000.00"))
    assert all(row["id"] for row in rows.values())
    assert "Fora do periodo" not in rows


def test_by_counterparty_respects_the_filters(client, headers):
    account, category = seed_counterparties(client, headers)
    rows, order = rows_of(
        client.get(f"{REPORTS}/by-counterparty", params={"date_from": "2026-03-01", "date_to": "2026-03-31", "category_id": category}, headers=headers)
    )
    assert order == ["Mercado Central"]
    assert Decimal(rows["Mercado Central"]["expense"]) == Decimal("50.00")


def test_by_counterparty_totals_match_the_summary(client, headers):
    seed_counterparties(client, headers)
    params = {"date_from": "2026-03-01", "date_to": "2026-03-31"}
    rows, _ = rows_of(client.get(f"{REPORTS}/by-counterparty", params=params, headers=headers))
    summary = client.get(f"{REPORTS}/summary", params=params, headers=headers).json()["currencies"][0]
    assert sum(Decimal(row["expense"]) for row in rows.values()) == Decimal(summary["expense"])
    assert sum(Decimal(row["income"]) for row in rows.values()) == Decimal(summary["income"])


def test_by_counterparty_requires_login_and_a_valid_period(client, headers):
    assert client.get(f"{REPORTS}/by-counterparty").status_code == 401
    response = client.get(f"{REPORTS}/by-counterparty", params={"date_from": "2026-03-31", "date_to": "2026-03-01"}, headers=headers)
    assert response.status_code == 422
