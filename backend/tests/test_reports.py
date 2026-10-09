from collections import defaultdict
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import event

from app.core import clock
from app.core.database import engine
from tests.conftest import auth_headers, make_user, register

URL = "/api/v1/reports"
TX_URL = "/api/v1/transactions"
PLACES = {"BRL": 2, "USD": 2, "JPY": 0}


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def post(client, headers, url, body):
    resp = client.post(url, json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


class World:
    """Dados ficticios de varios meses, moedas, categorias, tags e orcamentos. Guarda tambem uma
    lista simples do que foi criado (`records`) para o teste calcular o esperado por conta propria,
    sem usar o codigo que esta sendo testado."""

    def __init__(self, client, headers):
        self.client = client
        self.headers = headers
        self.records: list[dict] = []
        self.accounts = {}
        for name, currency, kind in [
            ("Nubank", "BRL", "asset"),
            ("Poupanca", "BRL", "asset"),
            ("Carteira Dolar", "USD", "asset"),
            ("Carteira Iene", "JPY", "asset"),
            ("Cartao Antigo", "BRL", "liability"),
        ]:
            body = {"name": name, "type": kind, "currency_code": currency, "opening_balance": "1000"}
            self.accounts[name] = post(client, headers, "/api/v1/accounts", body)["id"]
        self.categories = {
            n: post(client, headers, "/api/v1/categories", {"name": n, "kind": kind})["id"]
            for n, kind in [("Mercado", "expense"), ("Lazer", "expense"), ("Salario", "revenue")]
        }
        self.tags = {n: post(client, headers, "/api/v1/tags", {"name": n})["id"] for n in ["viagem", "trabalho"]}
        budget = {"name": "Casa", "currency_code": "BRL", "amount": "2000", "period": "monthly"}
        self.budgets = {"Casa": post(client, headers, "/api/v1/budgets", budget)["id"]}
        self.names = {
            **{v: k for k, v in self.categories.items()},
            **{v: k for k, v in self.tags.items()},
            **{v: k for k, v in self.budgets.items()},
            **{v: k for k, v in self.accounts.items()},
        }

    def add(self, kind, on, amount, currency="BRL", account="Nubank", category=None, tags=(), budget=None, **extra):
        """kind: income, expense, transfer, debt_payment ou debt_receipt."""
        split_type = {"income": "deposit", "expense": "withdrawal", "transfer": "transfer"}.get(
            kind, "withdrawal" if kind == "debt_payment" else "deposit"
        )
        split = {
            "type": split_type,
            "date": on,
            "description": f"{kind} {on}",
            "amount": amount,
            "currency_code": currency,
            "account_id": self.accounts[account],
            "tag_ids": [self.tags[t] for t in tags],
            **extra,
        }
        if category:
            split["category_id"] = self.categories[category]
        if budget:
            split["budget_id"] = self.budgets[budget]
        if kind == "transfer":
            split["counterparty_account_id"] = self.accounts["Poupanca"]
        elif kind in ("debt_payment", "debt_receipt"):
            split["counterparty_account_id"] = self.accounts["Cartao Antigo"]
        else:
            split["counterparty_name"] = "Loja Exemplo" if kind == "expense" else "Empresa Exemplo"
        post(self.client, self.headers, TX_URL, {"splits": [split]})
        self.records.append(
            {
                "kind": kind,
                "date": date.fromisoformat(on),
                "amount": Decimal(amount),
                "currency": currency,
                "account": account,
                "category": category,
                "tags": list(tags),
                "budget": budget,
            }
        )


def seed(client, headers) -> World:
    w = World(client, headers)
    # Janeiro
    w.add("income", "2026-01-05", "5000.00", category="Salario")
    w.add("expense", "2026-01-10", "200.50", category="Mercado", tags=["viagem", "trabalho"], budget="Casa")
    w.add("expense", "2026-01-20", "80.00", category="Lazer")
    w.add("income", "2026-01-15", "100.00", "USD", account="Carteira Dolar")
    # Fevereiro
    w.add("income", "2026-02-05", "5000.00", category="Salario")
    w.add("expense", "2026-02-12", "300.00", category="Mercado", tags=["viagem"], budget="Casa")
    w.add("expense", "2026-02-13", "45.90")
    w.add("expense", "2026-02-14", "30.00", "USD", account="Carteira Dolar", category="Mercado")
    w.add("expense", "2026-02-15", "1500", "JPY", account="Carteira Iene", category="Lazer")
    # Fora do relatorio: transferencia, pagamento e recebimento de divida
    w.add("transfer", "2026-02-16", "1000.00")
    w.add("debt_payment", "2026-02-17", "700.00")
    w.add("debt_receipt", "2026-02-18", "100.00")
    # Marco sem movimento; abril
    w.add("expense", "2026-04-02", "60.00", category="Lazer")
    return w


# ---------- Calculo independente do esperado ----------


def counted(records):
    return [r for r in records if r["kind"] in ("income", "expense")]


def matches(record, w, date_from=None, date_to=None, account=None, category=None, tag=None, budget=None):
    if date_from and record["date"] < date.fromisoformat(date_from):
        return False
    if date_to and record["date"] > date.fromisoformat(date_to):
        return False
    if account and record["account"] != account:
        return False
    if category and record["category"] != category:
        return False
    if tag and tag not in record["tags"]:
        return False
    if budget and record["budget"] != budget:
        return False
    return True


def fmt(value: Decimal, currency: str) -> str:
    return f"{value:.{PLACES[currency]}f}"


def expected_row(rows, currency):
    income = sum((r["amount"] for r in rows if r["kind"] == "income"), Decimal(0))
    expense = sum((r["amount"] for r in rows if r["kind"] == "expense"), Decimal(0))
    return {
        "income": fmt(income, currency),
        "expense": fmt(expense, currency),
        "net": fmt(income - expense, currency),
        "count": len(rows),
    }


def expected_grouped(w, dimension, **filters):
    rows = [r for r in counted(w.records) if matches(r, w, **filters)]
    fallback = {"category": "Sem categoria", "budget": "Sem orcamento", "tag": "Sem tag"}
    by_currency = defaultdict(list)
    for r in rows:
        by_currency[r["currency"]].append(r)
    blocks = []
    for currency in sorted(by_currency):
        items = by_currency[currency]
        groups = defaultdict(list)
        for r in items:
            if dimension == "tag":
                for tag in r["tags"] or [None]:
                    groups[tag].append(r)
            elif dimension == "account":
                groups[r["account"]].append(r)
            else:
                groups[r[dimension]].append(r)
        out = []
        for key, members in groups.items():
            lookup = {
                "category": w.categories,
                "budget": w.budgets,
                "tag": w.tags,
                "account": w.accounts,
            }[dimension]
            line = {
                "id": lookup[key] if key is not None else None,
                "name": key if key is not None else fallback[dimension],
                **expected_row(members, currency),
            }
            out.append(line)
        out.sort(key=lambda x: (-Decimal(x["expense"]), -Decimal(x["income"]), x["name"].lower()))
        blocks.append({"currency_code": currency, **expected_row(items, currency), "rows": out})
    return blocks


def expected_summary(w, **filters):
    rows = [r for r in counted(w.records) if matches(r, w, **filters)]
    by_currency = defaultdict(list)
    for r in rows:
        by_currency[r["currency"]].append(r)
    return [{"currency_code": c, **expected_row(by_currency[c], c)} for c in sorted(by_currency)]


def params_for(w, **filters):
    """Converte os filtros por nome nos parametros da API (ids)."""
    params = {}
    for key in ("date_from", "date_to"):
        if filters.get(key):
            params[key] = filters[key]
    if filters.get("account"):
        params["account_id"] = w.accounts[filters["account"]]
    if filters.get("category"):
        params["category_id"] = w.categories[filters["category"]]
    if filters.get("tag"):
        params["tag_id"] = w.tags[filters["tag"]]
    if filters.get("budget"):
        params["budget_id"] = w.budgets[filters["budget"]]
    return params


FULL = {"date_from": "2026-01-01", "date_to": "2026-12-31"}


def get(client, headers, path, **params):
    return client.get(f"{URL}/{path}", params=params, headers=headers)


# ---------- Totais ----------


def test_requires_login(client):
    for path in ("summary", "by-category", "by-tag", "by-budget", "by-account", "monthly"):
        assert client.get(f"{URL}/{path}").status_code == 401


def test_summary_matches_an_independent_calculation(client, headers):
    w = seed(client, headers)
    body = get(client, headers, "summary", **FULL).json()
    assert body["date_from"] == "2026-01-01" and body["date_to"] == "2026-12-31"
    assert body["currencies"] == expected_summary(w, **FULL)
    brl = body["currencies"][0]
    # Sanidade a mao: 10000 de receita, 686.40 de despesa, 5 lancamentos de despesa e 2 de receita
    assert (brl["currency_code"], brl["income"], brl["expense"], brl["net"], brl["count"]) == (
        "BRL",
        "10000.00",
        "686.40",
        "9313.60",
        7,
    )


def test_currencies_are_never_summed(client, headers):
    seed(client, headers)
    currencies = get(client, headers, "summary", **FULL).json()["currencies"]
    assert [c["currency_code"] for c in currencies] == ["BRL", "JPY", "USD"]
    jpy = next(c for c in currencies if c["currency_code"] == "JPY")
    # Iene sem casas decimais e sem misturar com os outros
    assert (jpy["income"], jpy["expense"], jpy["net"], jpy["count"]) == ("0", "1500", "-1500", 1)
    usd = next(c for c in currencies if c["currency_code"] == "USD")
    assert (usd["income"], usd["expense"], usd["net"]) == ("100.00", "30.00", "70.00")


def test_transfers_debts_and_opening_balance_are_left_out(client, headers):
    w = seed(client, headers)
    # O saldo inicial de 1000 e a transferencia, o pagamento e o recebimento de divida existem...
    assert len([r for r in w.records if r["kind"] not in ("income", "expense")]) == 3
    # ...mas so receitas e despesas em reais contam: 2 receitas e 5 despesas
    brl = get(client, headers, "summary", **FULL).json()["currencies"][0]
    assert brl["count"] == 7
    assert brl["income"] == "10000.00"


def test_empty_period_returns_no_currencies(client, headers):
    seed(client, headers)
    for path in ("summary", "by-category", "by-tag", "by-budget", "by-account", "monthly"):
        body = get(client, headers, path, date_from="2025-01-01", date_to="2025-01-31").json()
        assert body["currencies"] == [], path
    assert get(client, headers, "summary", date_from="2026-03-01", date_to="2026-03-31").json()["currencies"] == []


def test_user_without_any_transaction(client, headers):
    body = get(client, headers, "summary").json()
    assert body["currencies"] == []


def test_period_bounds_are_inclusive(client, headers):
    w = seed(client, headers)
    only_day = get(client, headers, "summary", date_from="2026-01-10", date_to="2026-01-10").json()["currencies"]
    assert only_day == expected_summary(w, date_from="2026-01-10", date_to="2026-01-10")
    assert only_day[0]["expense"] == "200.50"
    before = get(client, headers, "summary", date_from="2026-01-16", date_to="2026-01-19").json()["currencies"]
    assert before == []


# ---------- Agrupamentos ----------


@pytest.mark.parametrize("dimension", ["category", "tag", "budget", "account"])
def test_grouped_reports_match_an_independent_calculation(client, headers, dimension):
    w = seed(client, headers)
    body = get(client, headers, f"by-{dimension}", **FULL).json()
    assert body["currencies"] == expected_grouped(w, dimension, **FULL)


def test_category_report_has_a_row_without_category_and_orders_by_expense(client, headers):
    seed(client, headers)
    brl = get(client, headers, "by-category", **FULL).json()["currencies"][0]
    names = [row["name"] for row in brl["rows"]]
    assert names == ["Mercado", "Lazer", "Sem categoria", "Salario"]
    assert brl["rows"][2]["id"] is None
    assert brl["rows"][2]["expense"] == "45.90"
    assert brl["rows"][0]["expense"] == "500.50"


def test_budget_report_has_a_row_without_budget(client, headers):
    seed(client, headers)
    brl = get(client, headers, "by-budget", **FULL).json()["currencies"][0]
    assert [r["name"] for r in brl["rows"]] == ["Sem orcamento", "Casa"] or [r["name"] for r in brl["rows"]] == [
        "Casa",
        "Sem orcamento",
    ]
    casa = next(r for r in brl["rows"] if r["name"] == "Casa")
    assert casa["expense"] == "500.50" and casa["count"] == 2
    assert casa["id"] is not None


def test_tag_in_several_splits_does_not_inflate_the_total(client, headers):
    seed(client, headers)
    brl = get(client, headers, "by-tag", **FULL).json()["currencies"][0]
    rows = {r["name"]: r for r in brl["rows"]}
    # O lancamento de 200.50 tem duas tags: aparece nas duas linhas, mas conta uma vez no total
    assert rows["viagem"]["expense"] == "500.50" and rows["viagem"]["count"] == 2
    assert rows["trabalho"]["expense"] == "200.50" and rows["trabalho"]["count"] == 1
    assert "Sem tag" in rows and rows["Sem tag"]["id"] is None
    assert brl["expense"] == "686.40"
    assert sum(Decimal(r["expense"]) for r in brl["rows"]) > Decimal(brl["expense"])


def test_account_report_uses_the_users_account_on_both_sides(client, headers):
    seed(client, headers)
    brl = get(client, headers, "by-account", **FULL).json()["currencies"][0]
    assert [r["name"] for r in brl["rows"]] == ["Nubank"]
    assert brl["rows"][0]["income"] == "10000.00" and brl["rows"][0]["expense"] == "686.40"


@pytest.mark.parametrize(
    "filters",
    [
        {"account": "Nubank", "category": "Mercado"},
        {"tag": "viagem", "date_from": "2026-02-01", "date_to": "2026-02-28"},
        {"budget": "Casa", "category": "Mercado", "tag": "trabalho"},
        {"account": "Carteira Dolar", "date_from": "2026-01-01", "date_to": "2026-06-30"},
        {"category": "Lazer", "date_from": "2026-02-01"},
        {"date_to": "2026-01-31"},
    ],
)
def test_combined_filters_match_the_independent_calculation(client, headers, filters):
    w = seed(client, headers)
    params = params_for(w, **filters)
    # Sem as datas na chamada o periodo seria o mes atual; aqui o teste fixa o intervalo para comparar
    params.setdefault("date_from", "2026-01-01")
    params.setdefault("date_to", "2026-12-31")
    expected_filters = {**filters, "date_from": params["date_from"], "date_to": params["date_to"]}
    assert get(client, headers, "summary", **params).json()["currencies"] == expected_summary(w, **expected_filters)
    for dimension in ("category", "tag", "budget", "account"):
        got = get(client, headers, f"by-{dimension}", **params).json()["currencies"]
        assert got == expected_grouped(w, dimension, **expected_filters), dimension


def test_account_filter_matches_either_side(client, headers):
    w = seed(client, headers)
    # A conta de despesa "Loja Exemplo" e a ponta de destino das despesas do usuario
    expense_account = next(
        a for a in client.get("/api/v1/transactions/counterparties", params={"type": "expense"}, headers=headers).json()
    )
    brl = get(client, headers, "summary", account_id=expense_account["id"], **FULL).json()["currencies"]
    assert brl and all(Decimal(c["income"]) == 0 for c in brl)
    assert sum(c["count"] for c in brl) == len([r for r in w.records if r["kind"] == "expense"])


# ---------- Mensal ----------


def test_monthly_series_includes_empty_months(client, headers):
    seed(client, headers)
    blocks = get(client, headers, "monthly", date_from="2026-01-01", date_to="2026-04-30").json()["currencies"]
    brl = next(b for b in blocks if b["currency_code"] == "BRL")
    assert [m["month"] for m in brl["months"]] == ["2026-01", "2026-02", "2026-03", "2026-04"]
    assert brl["months"][0] == {"month": "2026-01", "income": "5000.00", "expense": "280.50", "net": "4719.50", "count": 3}
    assert brl["months"][1] == {"month": "2026-02", "income": "5000.00", "expense": "345.90", "net": "4654.10", "count": 3}
    assert brl["months"][2] == {"month": "2026-03", "income": "0.00", "expense": "0.00", "net": "0.00", "count": 0}
    assert brl["months"][3]["expense"] == "60.00"
    jpy = next(b for b in blocks if b["currency_code"] == "JPY")
    assert [m["expense"] for m in jpy["months"]] == ["0", "1500", "0", "0"]


def test_monthly_period_crossing_the_year(client, headers):
    seed(client, headers)
    blocks = get(client, headers, "monthly", date_from="2025-11-15", date_to="2026-01-31").json()["currencies"]
    brl = next(b for b in blocks if b["currency_code"] == "BRL")
    assert [m["month"] for m in brl["months"]] == ["2025-11", "2025-12", "2026-01"]
    assert brl["months"][2]["count"] == 3


def test_monthly_limit_is_120_months(client, headers):
    assert get(client, headers, "monthly", date_from="2016-01-01", date_to="2025-12-31").status_code == 200
    resp = get(client, headers, "monthly", date_from="2015-12-31", date_to="2025-12-31")
    assert resp.status_code == 422
    assert resp.json()["code"] == "validation_error"
    # O limite so vale para o grafico mensal
    assert get(client, headers, "summary", date_from="2000-01-01", date_to="2026-12-31").status_code == 200


# ---------- Periodo padrao e relogio ----------


def test_default_period_is_the_current_month_of_the_app_clock(client, headers, monkeypatch):
    w = seed(client, headers)
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 2, 15))
    body = get(client, headers, "summary").json()
    assert (body["date_from"], body["date_to"]) == ("2026-02-01", "2026-02-28")
    assert body["currencies"] == expected_summary(w, date_from="2026-02-01", date_to="2026-02-28")


def test_default_period_changes_with_the_clock_on_the_edge_of_the_month(client, headers, monkeypatch):
    seed(client, headers)
    # Meia-noite no Brasil: o app ainda esta em fevereiro (2026 nao e bissexto), um minuto depois em marco
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 2, 28))
    assert get(client, headers, "summary").json()["date_to"] == "2026-02-28"
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 3, 1))
    body = get(client, headers, "summary").json()
    assert (body["date_from"], body["date_to"]) == ("2026-03-01", "2026-03-31")
    assert body["currencies"] == []


def test_leap_year_and_december_defaults(client, headers, monkeypatch):
    monkeypatch.setattr(clock, "today", lambda now=None: date(2028, 2, 10))
    assert get(client, headers, "summary").json()["date_to"] == "2028-02-29"
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 12, 31))
    assert get(client, headers, "summary").json()["date_to"] == "2026-12-31"


def test_only_one_date_closes_the_month_of_the_other(client, headers, monkeypatch):
    monkeypatch.setattr(clock, "today", lambda now=None: date(2030, 1, 1))
    body = get(client, headers, "summary", date_from="2026-02-10").json()
    assert (body["date_from"], body["date_to"]) == ("2026-02-10", "2026-02-28")
    body = get(client, headers, "summary", date_to="2026-02-10").json()
    assert (body["date_from"], body["date_to"]) == ("2026-02-01", "2026-02-10")


# ---------- Validacao e isolamento ----------


@pytest.mark.parametrize("path", ["summary", "by-category", "by-tag", "by-budget", "by-account", "monthly"])
def test_date_from_after_date_to_is_422(client, headers, path):
    resp = get(client, headers, path, date_from="2026-03-02", date_to="2026-03-01")
    assert resp.status_code == 422
    body = resp.json()
    assert body["code"] == "validation_error"
    assert body["errors"][0]["field"] == "date_from"


@pytest.mark.parametrize(
    "params",
    [{"date_from": "01/02/2026"}, {"date_to": "2026-02-30"}, {"account_id": "nao-e-uuid"}, {"tag_id": "1"}],
)
def test_malformed_filters_are_422(client, headers, params):
    assert get(client, headers, "summary", **params).status_code == 422


def test_same_day_period_is_valid(client, headers):
    assert get(client, headers, "summary", date_from="2026-03-01", date_to="2026-03-01").status_code == 200


def test_users_never_see_each_others_data(client, headers, db_session):
    seed(client, headers)
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    for path in ("summary", "by-category", "by-tag", "by-budget", "by-account", "monthly"):
        assert get(client, other, path, **FULL).json()["currencies"] == []


def test_filter_with_a_resource_of_another_user_is_404(client, headers, db_session):
    w = seed(client, headers)
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    cases = {
        "account_id": ("account_not_found", w.accounts["Nubank"]),
        "category_id": ("category_not_found", w.categories["Mercado"]),
        "tag_id": ("tag_not_found", w.tags["viagem"]),
        "budget_id": ("budget_not_found", w.budgets["Casa"]),
    }
    for path in ("summary", "by-category", "by-tag", "by-budget", "by-account", "monthly"):
        for param, (code, value) in cases.items():
            resp = get(client, other, path, **{param: value}, **FULL)
            assert resp.status_code == 404, (path, param)
            assert resp.json()["code"] == code


def test_filter_with_an_unknown_id_is_404(client, headers):
    resp = get(client, headers, "summary", category_id="00000000-0000-4000-8000-000000000000")
    assert resp.status_code == 404 and resp.json()["code"] == "category_not_found"


def test_system_accounts_are_not_valid_filters(client, headers, db_session):
    from sqlalchemy import select

    from app.models.account import Account, AccountType

    seed(client, headers)
    system = db_session.execute(select(Account).where(Account.type == AccountType.initial_balance)).scalars().first()
    resp = get(client, headers, "summary", account_id=str(system.id))
    assert resp.status_code == 404


# ---------- Consultas ----------


def count_statements(client, headers, path, **params):
    statements: list[str] = []

    def record(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        assert get(client, headers, path, **params).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return len(statements)


@pytest.mark.parametrize("path", ["summary", "by-category", "by-tag", "by-budget", "by-account", "monthly"])
def test_number_of_queries_does_not_grow_with_the_data(client, headers, path):
    w = seed(client, headers)
    filters = {**FULL, "account_id": w.accounts["Nubank"], "category_id": w.categories["Mercado"]}
    small = count_statements(client, headers, path, **filters)
    for index in range(12):
        w.add("expense", f"2026-0{1 + index % 4}-2{index % 8}", "10.00", category="Mercado", tags=["viagem"], budget="Casa")
        w.add("income", "2026-02-01", "5.00", category="Salario")
    assert count_statements(client, headers, path, **filters) == small
    # Autenticacao, quatro conferencias de dono, o agrupamento (ate dois) e as casas decimais
    assert small <= 9


# ---------- Periodos prontos, resolvidos pelo relogio do app ----------


@pytest.mark.parametrize(
    ("today", "preset", "expected"),
    [
        (date(2026, 2, 15), "this-month", ("2026-02-01", "2026-02-28")),
        (date(2028, 2, 29), "this-month", ("2028-02-01", "2028-02-29")),
        (date(2026, 3, 1), "last-month", ("2026-02-01", "2026-02-28")),
        (date(2026, 3, 31), "last-month", ("2026-02-01", "2026-02-28")),
        (date(2028, 3, 10), "last-month", ("2028-02-01", "2028-02-29")),
        (date(2026, 1, 1), "last-month", ("2025-12-01", "2025-12-31")),
        (date(2026, 12, 31), "last-month", ("2026-11-01", "2026-11-30")),
        (date(2026, 1, 1), "this-year", ("2026-01-01", "2026-12-31")),
        (date(2026, 12, 31), "this-year", ("2026-01-01", "2026-12-31")),
        (date(2028, 6, 15), "this-year", ("2028-01-01", "2028-12-31")),
    ],
)
def test_presets_are_resolved_by_the_app_clock(client, headers, monkeypatch, today, preset, expected):
    monkeypatch.setattr(clock, "today", lambda now=None: today)
    for endpoint in ("summary", "by-category", "by-tag", "by-budget", "by-account"):
        body = get(client, headers, endpoint, period=preset).json()
        assert (body["date_from"], body["date_to"]) == expected, endpoint


def test_preset_on_the_monthly_chart(client, headers, monkeypatch):
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 5, 20))
    body = get(client, headers, "monthly", period="this-year").json()
    assert (body["date_from"], body["date_to"]) == ("2026-01-01", "2026-12-31")
    for block in body["currencies"]:
        assert [row["month"] for row in block["months"]] == [f"2026-{m:02d}" for m in range(1, 13)]


def test_preset_follows_the_clock_across_the_midnight(client, headers, monkeypatch):
    """O que o navegador achar do dia nao importa: so o relogio do app."""
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 2, 28))
    assert get(client, headers, "summary", period="this-month").json()["date_to"] == "2026-02-28"
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 3, 1))
    assert get(client, headers, "summary", period="this-month").json()["date_to"] == "2026-03-31"


def test_preset_numbers_match_the_same_period_asked_with_dates(client, headers, monkeypatch):
    w = seed(client, headers)
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 3, 10))
    by_preset = get(client, headers, "summary", period="last-month").json()
    by_dates = get(client, headers, "summary", date_from="2026-02-01", date_to="2026-02-28").json()
    assert by_preset == by_dates
    assert by_preset["currencies"] == expected_summary(w, date_from="2026-02-01", date_to="2026-02-28")


@pytest.mark.parametrize("extra", [{"date_from": "2026-02-01"}, {"date_to": "2026-02-28"}, {"date_from": "2026-02-01", "date_to": "2026-02-28"}])
def test_preset_cannot_be_mixed_with_dates(client, headers, extra):
    response = get(client, headers, "summary", period="this-month", **extra)
    assert response.status_code == 422
    assert "Use o periodo pronto ou as datas" in response.text


def test_unknown_preset_is_refused(client, headers):
    assert get(client, headers, "summary", period="ontem").status_code == 422


def test_preset_works_with_the_other_filters(client, headers, monkeypatch):
    w = seed(client, headers)
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 3, 10))
    body = get(client, headers, "summary", period="last-month", account_id=w.accounts["Nubank"]).json()
    assert body["currencies"] == expected_summary(w, date_from="2026-02-01", date_to="2026-02-28", account="Nubank")
