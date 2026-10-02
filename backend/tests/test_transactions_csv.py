import csv
import io
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import text

from app.core import clock
from app.core.database import SessionLocal
from app.services import transactions_csv
from app.services.transactions import TransactionFilters
from app.services.transactions_csv import HEADER, export_csv_chunks, format_money, safe_text
from tests.conftest import auth_headers, make_user, register

URL = "/api/v1/transactions/export.csv"
LIST_URL = "/api/v1/transactions"
ACCOUNTS_URL = "/api/v1/accounts"

EXPECTED_HEADER = (
    "data;tipo;descricao;conta_origem;conta_destino;valor;moeda;valor_estrangeiro;moeda_estrangeira;"
    "categoria;orcamento;tags;notas"
)


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_account(client, headers, name="Nubank", currency="BRL"):
    body = {"name": name, "type": "asset", "currency_code": currency, "opening_balance": "1000"}
    return client.post(ACCOUNTS_URL, json=body, headers=headers).json()["id"]


def make_named(client, headers, path, name, **extra):
    return client.post(f"/api/v1/{path}", json={"name": name, **extra}, headers=headers).json()["id"]


def create(client, headers, account_id, **overrides):
    split = {
        "type": "withdrawal",
        "date": "2026-02-01",
        "description": "Compra no mercado",
        "amount": "50.00",
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Supermercado",
        **overrides,
    }
    resp = client.post(LIST_URL, json={"splits": [split]}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def export(client, headers, **params):
    return client.get(URL, params=params, headers=headers)


def parse(resp):
    """Le o arquivo como o Excel leria: sem o BOM, com ponto e virgula e aspas."""
    text = resp.content.decode("utf-8-sig")
    return list(csv.reader(io.StringIO(text, newline=""), delimiter=";"))


# ---------- Formato do arquivo ----------


def test_requires_login(client):
    assert client.get(URL).status_code == 401


def test_header_is_exact_and_file_starts_with_bom(client, headers):
    resp = export(client, headers)
    assert resp.status_code == 200
    assert resp.content.startswith(b"\xef\xbb\xbf")
    assert resp.content.decode("utf-8") == "﻿" + EXPECTED_HEADER + "\r\n"
    assert HEADER == EXPECTED_HEADER.split(";")


def test_http_headers(client, headers, monkeypatch):
    monkeypatch.setattr(clock, "today", lambda now=None: date(2026, 3, 9))
    resp = export(client, headers)
    assert resp.headers["content-type"] == "text/csv; charset=utf-8"
    assert resp.headers["content-disposition"] == 'attachment; filename="lancamentos-2026-03-09.csv"'


def test_filename_follows_the_app_clock_not_the_machine(client, headers, monkeypatch):
    monkeypatch.setattr(clock, "today", lambda now=None: date(2031, 12, 31))
    assert "lancamentos-2031-12-31.csv" in export(client, headers).headers["content-disposition"]


def test_lines_end_with_crlf_and_decimal_uses_a_comma(client, headers):
    account = make_account(client, headers)
    create(client, headers, account, amount="1234.50")
    raw = export(client, headers).content.decode("utf-8")
    lines = raw.split("\r\n")
    assert lines[-1] == ""
    assert "\n" not in raw.replace("\r\n", "")
    assert lines[1].split(";")[5] == "1234,50"


def test_row_content(client, headers):
    account = make_account(client, headers)
    category = make_named(client, headers, "categories", "Mercado")
    tag_b = make_named(client, headers, "tags", "viagem")
    tag_a = make_named(client, headers, "tags", "Casa")
    budget = make_named(client, headers, "budgets", "Casa mensal", currency_code="BRL", amount="900", period="monthly")
    create(
        client,
        headers,
        account,
        date="2026-02-03",
        description="Pão e café",
        amount="12.30",
        category_id=category,
        budget_id=budget,
        tag_ids=[tag_b, tag_a],
        notes="Linha 1\nLinha 2",
        foreign_amount="2.50",
        foreign_currency_code="USD",
    )
    rows = parse(export(client, headers))
    assert rows[0] == HEADER
    assert rows[1] == [
        "2026-02-03",
        "Saída",
        "Pão e café",
        "Nubank",
        "Supermercado",
        "12,30",
        "BRL",
        "2,50",
        "USD",
        "Mercado",
        "Casa mensal",
        "Casa, viagem",
        "Linha 1\nLinha 2",
    ]


def test_deposit_and_transfer_labels(client, headers):
    first = make_account(client, headers)
    second = make_account(client, headers, name="Poupanca")
    create(client, headers, first, type="deposit", counterparty_name="Empresa")
    create(client, headers, first, type="transfer", counterparty_name=None, counterparty_account_id=second)
    rows = parse(export(client, headers))[1:]
    assert sorted(r[1] for r in rows) == ["Entrada", "Transferência"]
    transfer = next(r for r in rows if r[1] == "Transferência")
    assert transfer[3:5] == ["Nubank", "Poupanca"]


def test_jpy_has_no_decimal_places(client, headers):
    account = make_account(client, headers, name="Iene", currency="JPY")
    create(client, headers, account, amount="1500", currency_code="JPY")
    rows = parse(export(client, headers))
    assert rows[1][5] == "1500" and rows[1][6] == "JPY"


def test_empty_fields_are_empty_not_none(client, headers):
    account = make_account(client, headers)
    create(client, headers, account)
    row = parse(export(client, headers))[1]
    assert row[7:13] == ["", "", "", "", "", ""]


def test_fields_with_separator_quotes_and_line_breaks_are_quoted(client, headers):
    account = make_account(client, headers)
    create(client, headers, account, description='Almoço; "bom"', notes="a;b\r\nc")
    raw = export(client, headers).content.decode("utf-8")
    assert '"Almoço; ""bom"""' in raw
    assert '"a;b\r\nc"' in raw
    row = parse(export(client, headers))[1]
    assert row[2] == 'Almoço; "bom"' and row[12] == "a;b\r\nc"


def test_accents_survive_the_round_trip(client, headers):
    account = make_account(client, headers, name="Conta Ação")
    create(client, headers, account, description="Café com pão de queijo, ç ã é", counterparty_name="Padaria São João")
    row = parse(export(client, headers))[1]
    assert row[2] == "Café com pão de queijo, ç ã é"
    assert row[3] == "Conta Ação" and row[4] == "Padaria São João"


# ---------- Injecao de formula ----------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("=1+1", "'=1+1"),
        ("+55 27 99999", "'+55 27 99999"),
        ("-5,00", "'-5,00"),
        ("@SOMA(A1)", "'@SOMA(A1)"),
        ("\tabc", "'\tabc"),
        ("\rabc", "'\rabc"),
        ('=HYPERLINK("http://exemplo.test")', '\'=HYPERLINK("http://exemplo.test")'),
        # Nao comecam como formula: ficam como estao
        ("a=b", "a=b"),
        ("R$ -5", "R$ -5"),
        (" =1", " =1"),
        ("Normal", "Normal"),
        ("", ""),
        (None, ""),
    ],
)
def test_safe_text_table(value, expected):
    assert safe_text(value) == expected


@pytest.mark.parametrize(
    ("value", "places", "expected"),
    [
        (Decimal("-5"), 2, "-5,00"),
        (Decimal("0"), 2, "0,00"),
        (Decimal("1234.5"), 2, "1234,50"),
        (Decimal("1500"), 0, "1500"),
        (Decimal("-1500"), 0, "-1500"),
        (Decimal("0.1"), 2, "0,10"),
        (None, 2, ""),
    ],
)
def test_money_is_a_number_never_prefixed(value, places, expected):
    # Um valor negativo legitimo continua numero: o apostrofo e so para texto
    assert format_money(value, places) == expected


def test_every_text_column_is_protected_in_the_file(client, headers):
    account = make_account(client, headers, name="=Conta")
    category = make_named(client, headers, "categories", "+Categoria")
    tag = make_named(client, headers, "tags", "@tag")
    budget = make_named(client, headers, "budgets", "-Orcamento", currency_code="BRL", amount="900", period="monthly")
    create(
        client,
        headers,
        account,
        description="=SOMA(1;2)",
        counterparty_name="@Loja",
        category_id=category,
        budget_id=budget,
        tag_ids=[tag],
        notes="\tnota",
    )
    row = parse(export(client, headers))[1]
    assert row[2] == "'=SOMA(1;2)"
    assert row[3] == "'=Conta"
    assert row[4] == "'@Loja"
    assert row[9] == "'+Categoria"
    assert row[10] == "'-Orcamento"
    assert row[11] == "'@tag"
    assert row[12] == "'\tnota"
    # Numeros e datas nao levam apostrofo
    assert row[0] == "2026-02-01" and row[5] == "50,00"


# ---------- Fluxo em blocos ----------


def test_file_is_streamed_in_blocks(client, headers, db_session):
    account = make_account(client, headers)
    for index in range(5):
        create(client, headers, account, description=f"Compra {index}", date=f"2026-02-0{index + 1}")
    user_id = db_session.execute(text("select id from users")).scalar()

    with SessionLocal() as session:
        small = list(export_csv_chunks(session, user_id, TransactionFilters(), block_size=2))
        whole = list(export_csv_chunks(session, user_id, TransactionFilters(), block_size=200))
    # Cabecalho + 3 blocos (2 + 2 + 1 transacoes) contra cabecalho + 1 bloco
    assert len(small) == 4 and len(whole) == 2
    assert small[0].startswith(b"\xef\xbb\xbf")
    assert b"".join(small) == b"".join(whole)
    assert sum(chunk.count(b"\r\n") for chunk in small[1:]) == 5


def test_block_size_default_is_used_by_the_endpoint(client, headers, monkeypatch):
    account = make_account(client, headers)
    for index in range(3):
        create(client, headers, account, description=f"Compra {index}", date=f"2026-02-0{index + 1}")
    monkeypatch.setattr(transactions_csv, "BLOCK_SIZE", 1)
    rows = parse(export(client, headers))
    assert [r[2] for r in rows[1:]] == ["Compra 2", "Compra 1", "Compra 0"]


def test_blocks_do_not_repeat_or_skip_transactions_on_the_same_day(client, headers, monkeypatch):
    account = make_account(client, headers)
    for index in range(7):
        create(client, headers, account, description=f"Mesmo dia {index}")
    monkeypatch.setattr(transactions_csv, "BLOCK_SIZE", 2)
    names = [r[2] for r in parse(export(client, headers))[1:]]
    assert len(names) == 7 and len(set(names)) == 7


# ---------- Mesmos filtros da lista ----------


def csv_rows_vs_list(client, headers, **params):
    rows = parse(export(client, headers, **params))[1:]
    page = client.get(LIST_URL, params={"limit": 200, **params}, headers=headers).json()
    splits = [s for item in page["items"] for s in item["splits"]]
    assert len(rows) == len(splits)
    for row, split in zip(rows, splits, strict=True):
        assert row[0] == split["date"]
        assert row[2] == split["description"]
        assert row[3] == split["source_account_name"] and row[4] == split["destination_account_name"]
        assert row[5] == split["amount"].replace(".", ",")
    return rows


def test_csv_follows_the_same_filters_as_the_list(client, headers):
    first = make_account(client, headers)
    second = make_account(client, headers, name="Poupanca")
    category = make_named(client, headers, "categories", "Mercado")
    other_category = make_named(client, headers, "categories", "Lazer")
    tag = make_named(client, headers, "tags", "viagem")
    budget = make_named(client, headers, "budgets", "Casa", currency_code="BRL", amount="900", period="monthly")
    create(client, headers, first, description="Feira de domingo", amount="10.00", date="2026-01-05", category_id=category)
    create(client, headers, first, description="Cinema", amount="35.00", date="2026-01-20", category_id=other_category, tag_ids=[tag])
    create(client, headers, second, description="Aluguel", amount="800.00", date="2026-02-02", budget_id=budget)
    create(client, headers, second, type="deposit", description="Salario", amount="3000.00", date="2026-02-05", counterparty_name="Empresa")
    create(client, headers, first, type="transfer", description="Reserva", amount="100.00", date="2026-02-06", counterparty_name=None, counterparty_account_id=second)

    everything = csv_rows_vs_list(client, headers)
    assert len(everything) == 5
    filters = [
        {"account_id": first},
        {"account_id": second, "date_from": "2026-02-03"},
        {"category_id": category},
        {"tag_id": tag},
        {"budget_id": budget},
        {"date_from": "2026-01-10", "date_to": "2026-02-02"},
        {"q": "FEIRA"},
        {"q": "cin"},
        {"min_amount": "100"},
        {"max_amount": "35.00"},
        {"min_amount": "10", "max_amount": "100", "account_id": first},
        {"q": "nada que combine"},
    ]
    for params in filters:
        csv_rows_vs_list(client, headers, **params)
    assert csv_rows_vs_list(client, headers, q="nada que combine") == []


def test_filter_matches_the_group_but_the_file_has_all_its_splits(client, headers):
    """Igual a lista: o grupo entra se um split atende, e todos os splits dele saem."""
    account = make_account(client, headers)
    category = make_named(client, headers, "categories", "Mercado")
    body = {
        "title": "Compra dividida",
        "splits": [
            {
                "type": "withdrawal",
                "date": "2026-02-01",
                "description": f"Parte {n}",
                "amount": "10.00",
                "currency_code": "BRL",
                "account_id": account,
                "counterparty_name": "Mercado Exemplo",
                **({"category_id": category} if n == 1 else {}),
            }
            for n in (1, 2)
        ],
    }
    assert client.post(LIST_URL, json=body, headers=headers).status_code == 201
    rows = csv_rows_vs_list(client, headers, category_id=category)
    assert [r[2] for r in rows] == ["Parte 1", "Parte 2"]


def test_csv_only_has_the_users_own_transactions(client, headers, db_session):
    account = make_account(client, headers)
    create(client, headers, account, description="Minha compra")
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    other_account = make_account(client, other, name="Conta dela")
    create(client, other, other_account, description="Compra dela")

    mine = [r[2] for r in parse(export(client, headers))[1:]]
    theirs = [r[2] for r in parse(export(client, other))[1:]]
    assert mine == ["Minha compra"] and theirs == ["Compra dela"]
    # Filtrar pela conta de outro usuario nao revela nada
    assert parse(export(client, headers, account_id=other_account))[1:] == []


def test_system_transactions_are_not_exported(client, headers):
    make_account(client, headers)
    # Existe o saldo inicial de 1000, mas ele nao e lancamento do usuario
    assert parse(export(client, headers))[1:] == []


def test_invalid_filters_are_422(client, headers):
    assert export(client, headers, date_from="ontem").status_code == 422
    assert export(client, headers, account_id="x").status_code == 422
    assert export(client, headers, min_amount="1.234").status_code == 422
