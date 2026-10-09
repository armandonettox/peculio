import json
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.core import clock
from app.core.config import settings
from app.core.upload_limit import MULTIPART_OVERHEAD
from app.models.transaction import TransactionSplit
from app.services import imports as imports_service
from tests.conftest import auth_headers, make_user, register
from tests.webhook_support import no_real_dns  # noqa: F401

API = "/api/v1"
PREVIEW = f"{API}/imports/preview"
CONFIRM = f"{API}/imports/confirm"
ACCOUNTS = f"{API}/accounts"
TX = f"{API}/transactions"

# Letras com acento montadas por codigo: o arquivo de teste fica so em ASCII
CEDILLA, ATILDE = chr(231), chr(227)


@pytest.fixture
def headers(client):
    register(client)
    return auth_headers(client)


def make_account(client, headers, **overrides):
    body = {"name": "Nubank", "type": "asset", "currency_code": "BRL", "opening_balance": "1000.00", **overrides}
    return client.post(ACCOUNTS, json=body, headers=headers).json()["id"]


@pytest.fixture
def account_id(client, headers):
    return make_account(client, headers)


def upload(client, headers, account_id, content, name="extrato.csv", mapping=None):
    if isinstance(content, str):
        content = content.encode("utf-8")
    data = {"account_id": account_id}
    if mapping is not None:
        data["mapping"] = mapping if isinstance(mapping, str) else json.dumps(mapping)
    return client.post(PREVIEW, data=data, files={"file": (name, content)}, headers=headers)


def confirm(client, headers, account_id, rows):
    return client.post(CONFIRM, json={"account_id": account_id, "rows": rows}, headers=headers)


def balance_of(client, headers, account_id):
    return client.get(f"{ACCOUNTS}/{account_id}", headers=headers).json()["balance"]


def split_count(db_session):
    return db_session.execute(select(func.count()).select_from(TransactionSplit)).scalar_one()


def spend(client, headers, account_id, description, amount, day, kind="withdrawal"):
    split = {
        "type": kind,
        "date": day,
        "description": description,
        "amount": amount,
        "currency_code": "BRL",
        "account_id": account_id,
        "counterparty_name": "Loja",
    }
    response = client.post(TX, json={"splits": [split]}, headers=headers)
    assert response.status_code == 201, response.text
    return response


CSV_TEXT = (
    "Data;Descricao;Valor\n"
    "05/03/2026;Mercado Bom Preco;-50,00\n"
    "06/03/2026;Salario;1.000,00\n"
    "07/03/2026;Padaria;-12,50\n"
)

OFX_TEXT = """OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260305120000
<TRNAMT>-50.00
<FITID>F1
<MEMO>COMPRA MERCADO
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260306
<TRNAMT>1000.00
<FITID>F2
<NAME>SALARIO
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
"""


# ---------- Acesso ----------


def test_requires_login(client):
    assert client.post(PREVIEW, data={"account_id": str(uuid.uuid4())}, files={"file": ("a.csv", b"x")}).status_code == 401
    assert client.post(CONFIRM, json={}).status_code == 401


def test_other_users_account_is_404_and_a_liability_is_refused(client, headers, account_id, db_session):
    make_user(db_session, email="outra@example.com")
    other = auth_headers(client, email="outra@example.com")
    for response in (
        upload(client, other, account_id, CSV_TEXT),
        confirm(client, other, account_id, [{"date": "2026-03-05", "description": "X", "amount": "-1.00"}]),
        upload(client, headers, str(uuid.uuid4()), CSV_TEXT),
    ):
        assert response.status_code == 404 and response.json()["code"] == "account_not_found"

    debt = make_account(client, headers, name="Financiamento", type="liability", role="mortgage", opening_balance="5000.00")
    for response in (
        upload(client, headers, debt, CSV_TEXT),
        confirm(client, headers, debt, [{"date": "2026-03-05", "description": "X", "amount": "-1.00"}]),
    ):
        assert response.status_code == 400 and response.json()["code"] == "import_account_invalid"


# ---------- Previa de CSV ----------


def test_preview_guesses_the_columns_and_lists_every_row_without_saving(client, headers, account_id, db_session):
    body = upload(client, headers, account_id, CSV_TEXT).json()
    assert body["format"] == "csv" and body["needs_mapping"] is False
    assert body["account_id"] == account_id
    assert body["columns"] == ["Data", "Descricao", "Valor"]
    assert body["sample"] == [["05/03/2026", "Mercado Bom Preco", "-50,00"], ["06/03/2026", "Salario", "1.000,00"], ["07/03/2026", "Padaria", "-12,50"]]
    assert body["mapping"] == {
        "date_column": 0,
        "description_column": 1,
        "amount_column": 2,
        "debit_column": None,
        "credit_column": None,
        "has_header": True,
    }
    assert body["counts"] == {"new": 3, "duplicate": 0, "error": 0}
    assert [(r["index"], r["date"], r["description"], r["amount"], r["status"]) for r in body["rows"]] == [
        (2, "2026-03-05", "Mercado Bom Preco", "-50.00", "new"),
        (3, "2026-03-06", "Salario", "1000.00", "new"),
        (4, "2026-03-07", "Padaria", "-12.50", "new"),
    ]
    assert all(r["external_id"] is None and r["duplicate_kind"] is None and r["reason"] is None for r in body["rows"])
    assert split_count(db_session) == 1  # so o saldo inicial
    assert balance_of(client, headers, account_id) == "1000.00"


def test_preview_with_an_explicit_mapping_and_no_header(client, headers, account_id):
    text = "05/03/2026;Mercado;-50,00\n"
    mapping = {"date_column": 0, "description_column": 1, "amount_column": 2, "has_header": False}
    body = upload(client, headers, account_id, text, mapping=mapping).json()
    assert body["needs_mapping"] is False and body["columns"] == ["Coluna 1", "Coluna 2", "Coluna 3"]
    assert [(r["index"], r["amount"]) for r in body["rows"]] == [(1, "-50.00")]


def test_preview_with_debit_and_credit_columns(client, headers, account_id):
    text = "Data;Historico;Debito;Credito\n05/03/2026;Mercado;50,00;\n06/03/2026;Salario;;1000,00\n"
    body = upload(client, headers, account_id, text).json()
    assert body["mapping"]["debit_column"] == 2 and body["mapping"]["credit_column"] == 3
    assert [r["amount"] for r in body["rows"]] == ["-50.00", "1000.00"]


def test_preview_asks_for_the_columns_when_it_cannot_guess(client, headers, account_id):
    text = "a;b;c;d;e;f;g\n1;2;3;4;5;6;7\n05/03/2026;Mercado;-50,00;x;y;z;w\n"
    body = upload(client, headers, account_id, text).json()
    assert body["needs_mapping"] is True and body["mapping"] is None and body["rows"] == []
    assert body["columns"] == list("abcdefg")
    assert len(body["sample"]) == 2 and body["sample"][0] == list("1234567")
    assert body["counts"] == {"new": 0, "duplicate": 0, "error": 0}


def test_preview_sample_has_at_most_five_rows(client, headers, account_id):
    text = "Data;Descricao;Valor\n" + "".join(f"0{n}/03/2026;Item {n};-1,00\n" for n in range(1, 9))
    body = upload(client, headers, account_id, text).json()
    assert len(body["sample"]) == 5 and len(body["rows"]) == 8


def test_preview_reads_windows_1252_and_comma_separated_files(client, headers, account_id):
    text = f"Data,Descri{CEDILLA}{ATILDE}o,Valor\n05/03/2026,Caf{chr(233)} da esquina,\"-8,50\"\n"
    body = upload(client, headers, account_id, text.encode("cp1252")).json()
    assert body["rows"][0]["description"] == f"Caf{chr(233)} da esquina" and body["rows"][0]["amount"] == "-8.50"


def test_preview_marks_each_bad_row_with_its_reason_and_still_lists_the_good_ones(client, headers, account_id):
    text = (
        "Data;Descricao;Valor\n"
        "31/02/2026;Data ruim;-5,00\n"
        "05/03/2026;;-5,00\n"
        "05/03/2026;Valor ruim;abc\n"
        "05/03/2026;Valor zero;0,00\n"
        "05/03/2026;Quatro casas;-5,1234\n"
        "05/03/2026;Boa;-5,00\n"
    )
    body = upload(client, headers, account_id, text).json()
    assert [(r["status"], r["reason"]) for r in body["rows"]] == [
        ("error", "Data inexistente"),
        ("error", "Descricao vazia"),
        ("error", "Valor invalido"),
        ("error", "Valor zero"),
        ("error", "Valor com mais de 2 casas decimais"),
        ("new", None),
    ]
    assert body["counts"] == {"new": 1, "duplicate": 0, "error": 5}
    assert all(r["amount"] is None for r in body["rows"][:3])


def test_preview_refuses_a_date_too_far_in_the_future(client, headers, account_id):
    far = (clock.today() + timedelta(days=400)).strftime("%d/%m/%Y")
    near = (clock.today() + timedelta(days=30)).strftime("%d/%m/%Y")
    body = upload(client, headers, account_id, f"Data;Descricao;Valor\n{far};Longe;-5,00\n{near};Perto;-5,00\n").json()
    assert [(r["status"], r["reason"]) for r in body["rows"]] == [("error", "Data muito longe no futuro"), ("new", None)]


def test_preview_checks_the_amount_against_the_account_currency_places(client, headers):
    yen = make_account(client, headers, name="Yen", currency_code="JPY", opening_balance="1000")
    body = upload(client, headers, yen, "Data;Descricao;Valor\n05/03/2026;Ramen;-50,50\n05/03/2026;Ramen;-50\n").json()
    assert body["rows"][0]["status"] == "error" and "JPY" in body["rows"][0]["reason"]
    assert body["rows"][1]["status"] == "new"


# ---------- Previa: erros do arquivo ----------


@pytest.mark.parametrize("content", [b"", b"   \n\n  ", b";;;\n;;;\n"])
def test_preview_refuses_an_empty_file(client, headers, account_id, content):
    response = upload(client, headers, account_id, content)
    assert response.status_code == 422 and response.json()["code"] == "import_file_invalid"


def test_preview_refuses_a_binary_file(client, headers, account_id):
    response = upload(client, headers, account_id, b"%PDF-1.4\x00\x01\x02binario", name="x.pdf")
    assert response.status_code == 422 and response.json()["code"] == "import_file_invalid"


def test_preview_refuses_a_csv_with_a_header_and_no_rows(client, headers, account_id):
    response = upload(client, headers, account_id, "Data;Descricao;Valor\n")
    assert response.status_code == 422 and response.json()["code"] == "import_file_invalid"
    assert "nenhum lancamento" in response.json()["detail"]


def test_preview_refuses_too_many_rows(client, headers, account_id, monkeypatch):
    monkeypatch.setattr(settings, "import_max_rows", 2)
    response = upload(client, headers, account_id, CSV_TEXT)
    assert response.status_code == 422 and response.json()["code"] == "import_too_many_rows"
    monkeypatch.setattr(settings, "import_max_rows", 3)
    assert upload(client, headers, account_id, CSV_TEXT).status_code == 200


def test_preview_refuses_a_file_over_the_size_limit(client, headers, account_id, monkeypatch):
    monkeypatch.setattr(settings, "import_max_bytes", 100)
    big = "Data;Descricao;Valor\n" + "05/03/2026;Item;-1,00\n" * 20
    response = upload(client, headers, account_id, big)
    assert response.status_code == 413 and response.json()["code"] == "import_file_too_large"
    assert "limite" in response.json()["detail"]


def test_the_size_limit_is_refused_early_by_the_declared_length(client, headers, account_id, monkeypatch):
    monkeypatch.setattr(settings, "import_max_bytes", 100)
    huge = b"x" * (100 + MULTIPART_OVERHEAD + 10)
    response = client.post(PREVIEW, data={"account_id": account_id}, files={"file": ("a.csv", huge)}, headers=headers)
    assert response.status_code == 413 and response.json()["code"] == "import_file_too_large"


def test_a_file_exactly_at_the_limit_is_accepted(client, headers, account_id, monkeypatch):
    content = CSV_TEXT.encode()
    monkeypatch.setattr(settings, "import_max_bytes", len(content))
    assert upload(client, headers, account_id, content).status_code == 200
    monkeypatch.setattr(settings, "import_max_bytes", len(content) - 1)
    assert upload(client, headers, account_id, content).status_code == 413


@pytest.mark.parametrize(
    "mapping",
    [
        "isto nao e json",
        {"date_column": -1, "description_column": 1, "amount_column": 2},
        {"date_column": 0, "description_column": 1, "amount_column": 2, "extra": 1},
        {"description_column": 1, "amount_column": 2},
    ],
)
def test_preview_refuses_a_malformed_mapping(client, headers, account_id, mapping):
    response = upload(client, headers, account_id, CSV_TEXT, mapping=mapping)
    assert response.status_code == 422 and response.json()["code"] == "validation_error"


@pytest.mark.parametrize(
    "mapping",
    [
        {"date_column": 0, "description_column": 1},
        {"date_column": 0, "description_column": 1, "amount_column": 9},
        {"date_column": 0, "description_column": 0, "amount_column": 2},
        {"date_column": 0, "description_column": 1, "amount_column": 2, "debit_column": 1, "credit_column": 2},
    ],
)
def test_preview_refuses_a_mapping_that_does_not_fit_the_file(client, headers, account_id, mapping):
    response = upload(client, headers, account_id, CSV_TEXT, mapping=mapping)
    assert response.status_code == 422 and response.json()["code"] == "import_file_invalid"


def test_preview_accepts_an_empty_mapping_field_as_no_mapping(client, headers, account_id):
    assert upload(client, headers, account_id, CSV_TEXT, mapping="  ").json()["mapping"]["amount_column"] == 2


# ---------- Previa de OFX ----------


def test_preview_of_an_ofx_file(client, headers, account_id):
    body = upload(client, headers, account_id, OFX_TEXT, name="extrato.ofx").json()
    assert body["format"] == "ofx" and body["columns"] is None and body["sample"] is None
    assert body["mapping"] is None and body["needs_mapping"] is False
    assert [(r["index"], r["date"], r["description"], r["amount"], r["external_id"], r["status"]) for r in body["rows"]] == [
        (1, "2026-03-05", "COMPRA MERCADO", "-50.00", "F1", "new"),
        (2, "2026-03-06", "SALARIO", "1000.00", "F2", "new"),
    ]


def test_ofx_is_detected_by_content_not_by_the_file_name(client, headers, account_id):
    assert upload(client, headers, account_id, OFX_TEXT, name="extrato.csv").json()["format"] == "ofx"
    assert upload(client, headers, account_id, CSV_TEXT, name="extrato.ofx").json()["format"] == "csv"


def test_ofx_in_another_currency_than_the_account_is_refused(client, headers):
    dollars = make_account(client, headers, name="Dolar", currency_code="USD")
    response = upload(client, headers, dollars, OFX_TEXT, name="extrato.ofx")
    assert response.status_code == 422 and response.json()["code"] == "import_file_invalid"
    assert "BRL" in response.json()["detail"] and "USD" in response.json()["detail"]


def test_ofx_without_currency_is_accepted(client, headers, account_id):
    text = OFX_TEXT.replace("<CURDEF>BRL\n", "")
    assert upload(client, headers, account_id, text, name="extrato.ofx").status_code == 200


def test_ofx_without_transactions_is_refused(client, headers, account_id):
    response = upload(client, headers, account_id, "OFXHEADER:100\n<OFX></OFX>", name="extrato.ofx")
    assert response.status_code == 422 and response.json()["code"] == "import_file_invalid"


# ---------- Repetidos: parece repetida ----------


def test_a_row_equal_to_an_existing_transaction_is_marked_as_similar(client, headers, account_id):
    spend(client, headers, account_id, "Mercado Bom Preco", "50.00", "2026-03-05")
    body = upload(client, headers, account_id, CSV_TEXT).json()
    first = body["rows"][0]
    assert first["status"] == "duplicate" and first["duplicate_kind"] == "similar"
    assert "igual" in first["reason"]
    assert [r["status"] for r in body["rows"]] == ["duplicate", "new", "new"]
    assert body["counts"] == {"new": 2, "duplicate": 1, "error": 0}


def test_similar_ignores_case_accents_and_extra_spaces(client, headers, account_id):
    spend(client, headers, account_id, f"  CAF{chr(201)}   da  Esquina ", "8.50", "2026-03-05")
    text = f"Data;Descricao;Valor\n05/03/2026;cafe da esquina;-8,50\n"
    assert upload(client, headers, account_id, text).json()["rows"][0]["status"] == "duplicate"


@pytest.mark.parametrize(
    "existing_day, existing_amount, existing_kind",
    [
        ("2026-03-06", "50.00", "withdrawal"),  # outro dia
        ("2026-03-05", "50.01", "withdrawal"),  # outro valor
        ("2026-03-05", "50.00", "deposit"),  # outro sentido: entrou, e o arquivo diz que saiu
    ],
)
def test_a_different_day_amount_or_direction_is_not_a_duplicate(
    client, headers, account_id, existing_day, existing_amount, existing_kind
):
    spend(client, headers, account_id, "Mercado Bom Preco", existing_amount, existing_day, kind=existing_kind)
    text = "Data;Descricao;Valor\n05/03/2026;Mercado Bom Preco;-50,00\n"
    assert upload(client, headers, account_id, text).json()["rows"][0]["status"] == "new"


def test_an_identical_transaction_in_another_account_does_not_count(client, headers, account_id):
    other = make_account(client, headers, name="Itau")
    spend(client, headers, other, "Mercado Bom Preco", "50.00", "2026-03-05")
    text = "Data;Descricao;Valor\n05/03/2026;Mercado Bom Preco;-50,00\n"
    assert upload(client, headers, account_id, text).json()["rows"][0]["status"] == "new"


def test_two_equal_rows_are_both_new_when_nothing_exists_yet(client, headers, account_id):
    text = "Data;Descricao;Valor\n05/03/2026;Cafe;-8,00\n05/03/2026;Cafe;-8,00\n"
    assert [r["status"] for r in upload(client, headers, account_id, text).json()["rows"]] == ["new", "new"]


def test_two_equal_rows_with_one_existing_only_the_first_is_the_duplicate(client, headers, account_id):
    spend(client, headers, account_id, "Cafe", "8.00", "2026-03-05")
    text = "Data;Descricao;Valor\n05/03/2026;Cafe;-8,00\n05/03/2026;Cafe;-8,00\n"
    assert [r["status"] for r in upload(client, headers, account_id, text).json()["rows"]] == ["duplicate", "new"]


def test_a_transfer_into_the_account_counts_as_an_entry(client, headers, account_id):
    other = make_account(client, headers, name="Poupanca")
    split = {
        "type": "transfer", "date": "2026-03-06", "description": "Salario", "amount": "1000.00",
        "currency_code": "BRL", "account_id": other, "counterparty_account_id": account_id,
    }
    assert client.post(TX, json={"splits": [split]}, headers=headers).status_code == 201
    body = upload(client, headers, account_id, CSV_TEXT).json()
    assert [r["status"] for r in body["rows"]] == ["new", "duplicate", "new"]
    # Para a conta de origem a mesma transferencia e uma saida
    text = "Data;Descricao;Valor\n06/03/2026;Salario;-1000,00\n"
    assert upload(client, headers, other, text).json()["rows"][0]["status"] == "duplicate"


def test_a_previous_import_of_the_same_csv_makes_every_row_a_duplicate(client, headers, account_id):
    rows = [r for r in upload(client, headers, account_id, CSV_TEXT).json()["rows"]]
    payload = [{"date": r["date"], "description": r["description"], "amount": r["amount"]} for r in rows]
    assert confirm(client, headers, account_id, payload).status_code == 201
    again = upload(client, headers, account_id, CSV_TEXT).json()
    assert [r["status"] for r in again["rows"]] == ["duplicate"] * 3
    assert again["counts"] == {"new": 0, "duplicate": 3, "error": 0}


def test_rows_with_errors_never_count_as_duplicates(client, headers, account_id):
    spend(client, headers, account_id, "Cafe", "8.00", "2026-03-05")
    text = "Data;Descricao;Valor\n05/03/2026;Cafe;-8,00\n99/99/2026;Cafe;-8,00\n"
    assert [r["status"] for r in upload(client, headers, account_id, text).json()["rows"]] == ["duplicate", "error"]


def test_a_file_where_every_row_has_an_error_still_returns_the_preview(client, headers, account_id):
    body = upload(client, headers, account_id, "Data;Descricao;Valor\nxx;;abc\n").json()
    assert body["counts"] == {"new": 0, "duplicate": 0, "error": 1}


# ---------- Repetidos: mesmo identificador do banco ----------


def test_after_importing_an_ofx_the_same_file_is_all_same_id(client, headers, account_id):
    rows = upload(client, headers, account_id, OFX_TEXT, name="a.ofx").json()["rows"]
    payload = [{"date": r["date"], "description": r["description"], "amount": r["amount"], "external_id": r["external_id"]} for r in rows]
    assert confirm(client, headers, account_id, payload).status_code == 201
    again = upload(client, headers, account_id, OFX_TEXT, name="a.ofx").json()
    assert [(r["status"], r["duplicate_kind"]) for r in again["rows"]] == [("duplicate", "same_id")] * 2
    assert "identificador" in again["rows"][0]["reason"]


def test_same_id_survives_editing_the_imported_transaction(client, headers, account_id, db_session):
    rows = upload(client, headers, account_id, OFX_TEXT, name="a.ofx").json()["rows"]
    payload = [{"date": r["date"], "description": r["description"], "amount": r["amount"], "external_id": r["external_id"]} for r in rows]
    confirm(client, headers, account_id, payload)
    listed = client.get(TX, params={"q": "COMPRA MERCADO"}, headers=headers).json()["items"][0]
    edited = {
        "splits": [
            {
                "type": "withdrawal", "date": "2026-03-05", "description": "Mercado do mes", "amount": "52.00",
                "currency_code": "BRL", "account_id": account_id, "counterparty_name": "Mercado",
            }
        ]
    }
    assert client.put(f"{TX}/{listed['id']}", json=edited, headers=headers).status_code == 200
    # Descricao e valor mudaram, mas o identificador do banco continua: o mesmo extrato nao duplica
    again = upload(client, headers, account_id, OFX_TEXT, name="a.ofx").json()
    assert [(r["status"], r["duplicate_kind"]) for r in again["rows"]] == [("duplicate", "same_id")] * 2
    saved = db_session.execute(select(TransactionSplit).where(TransactionSplit.external_id == "F1")).scalar_one()
    assert saved.description == "Mercado do mes" and str(saved.external_account_id) == account_id


def test_editing_a_transaction_that_was_not_imported_adds_no_external_id(client, headers, account_id, db_session):
    made = spend(client, headers, account_id, "Cafe", "8.00", "2026-03-05").json()
    edited = {
        "splits": [
            {
                "type": "withdrawal", "date": "2026-03-05", "description": "Cafe 2", "amount": "9.00",
                "currency_code": "BRL", "account_id": account_id, "counterparty_name": "Loja",
            }
        ]
    }
    assert client.put(f"{TX}/{made['id']}", json=edited, headers=headers).status_code == 200
    assert db_session.execute(select(func.count()).select_from(TransactionSplit).where(TransactionSplit.external_id.is_not(None))).scalar_one() == 0


def test_the_same_fitid_twice_in_one_file_marks_the_second(client, headers, account_id):
    text = OFX_TEXT.replace("<FITID>F2", "<FITID>F1").replace("<TRNAMT>1000.00", "<TRNAMT>-70.00")
    body = upload(client, headers, account_id, text, name="a.ofx").json()
    assert [(r["status"], r["duplicate_kind"]) for r in body["rows"]] == [("new", None), ("duplicate", "same_id")]


def test_the_same_fitid_in_another_account_is_new(client, headers, account_id):
    rows = upload(client, headers, account_id, OFX_TEXT, name="a.ofx").json()["rows"]
    payload = [{"date": r["date"], "description": r["description"], "amount": r["amount"], "external_id": r["external_id"]} for r in rows]
    confirm(client, headers, account_id, payload)
    other = make_account(client, headers, name="Itau")
    body = upload(client, headers, other, OFX_TEXT, name="a.ofx").json()
    assert [r["status"] for r in body["rows"]] == ["new", "new"]


def test_a_new_fitid_with_the_same_content_as_a_manual_entry_is_similar(client, headers, account_id):
    spend(client, headers, account_id, "COMPRA MERCADO", "50.00", "2026-03-05")
    body = upload(client, headers, account_id, OFX_TEXT, name="a.ofx").json()
    assert [(r["status"], r["duplicate_kind"]) for r in body["rows"]] == [("duplicate", "similar"), ("new", None)]


# ---------- Confirmar ----------


def test_confirm_creates_entries_and_exits_in_the_chosen_account(client, headers, account_id, db_session):
    rows = [
        {"date": "2026-03-05", "description": "Mercado Bom Preco", "amount": "-50.00"},
        {"date": "2026-03-06", "description": "Salario", "amount": "1000.00"},
    ]
    response = confirm(client, headers, account_id, rows)
    assert response.status_code == 201 and response.json() == {"created": 2, "skipped": 0}
    assert balance_of(client, headers, account_id) == "1950.00"

    listed = client.get(TX, params={"account_id": account_id}, headers=headers).json()["items"]
    by_description = {item["splits"][0]["description"]: item["splits"][0] for item in listed}
    market, salary = by_description["Mercado Bom Preco"], by_description["Salario"]
    assert (market["type"], market["amount"], market["date"], market["currency_code"]) == ("withdrawal", "50.00", "2026-03-05", "BRL")
    assert market["source_account_id"] == account_id and market["destination_account_name"] == "Mercado Bom Preco"
    assert (salary["type"], salary["amount"]) == ("deposit", "1000.00")
    assert salary["destination_account_id"] == account_id and salary["source_account_name"] == "Salario"


def test_confirm_in_a_foreign_currency_account_uses_its_currency(client, headers):
    dollars = make_account(client, headers, name="Dolar", currency_code="USD", opening_balance="100.00")
    assert confirm(client, headers, dollars, [{"date": "2026-03-05", "description": "Hotel", "amount": "-30.00"}]).status_code == 201
    assert balance_of(client, headers, dollars) == "70.00"


def test_confirm_runs_the_rules_like_any_new_transaction(client, headers, account_id):
    category = client.post(f"{API}/categories", json={"name": "Mercado", "kind": "expense"}, headers=headers).json()["id"]
    rule = {
        "name": "Mercado",
        "triggers": [{"field": "description", "op": "contains", "value": "mercado"}],
        "actions": [{"kind": "set_category", "target_id": category}],
    }
    assert client.post(f"{API}/rules", json=rule, headers=headers).status_code == 201
    confirm(client, headers, account_id, [
        {"date": "2026-03-05", "description": "Compra Mercado Bom Preco", "amount": "-50.00"},
        {"date": "2026-03-05", "description": "Padaria", "amount": "-5.00"},
    ])
    items = client.get(TX, params={"account_id": account_id}, headers=headers).json()["items"]
    by_description = {item["splits"][0]["description"]: item["splits"][0]["category_id"] for item in items}
    assert by_description["Compra Mercado Bom Preco"] == category and by_description["Padaria"] is None


def test_confirm_links_a_matching_bill_like_any_new_transaction(client, headers, account_id):
    bill = {
        "name": "Netflix", "currency_code": "BRL", "amount_min": "40.00", "amount_max": "60.00",
        "match_text": "netflix", "first_due_date": "2026-03-05", "frequency": "monthly",
    }
    bill_id = client.post(f"{API}/bills", json=bill, headers=headers).json()["id"]
    confirm(client, headers, account_id, [{"date": "2026-03-06", "description": "Assinatura Netflix", "amount": "-55.90"}])
    items = client.get(TX, params={"account_id": account_id}, headers=headers).json()["items"]
    assert items[0]["splits"][0]["bill_id"] == bill_id


def test_confirm_saves_the_external_id_and_skips_a_known_one(client, headers, account_id, db_session):
    row = {"date": "2026-03-05", "description": "Compra", "amount": "-50.00", "external_id": "F1"}
    assert confirm(client, headers, account_id, [row]).json() == {"created": 1, "skipped": 0}
    saved = db_session.execute(select(TransactionSplit).where(TransactionSplit.external_id == "F1")).scalar_one()
    assert str(saved.external_account_id) == account_id
    assert confirm(client, headers, account_id, [row]).json() == {"created": 0, "skipped": 1}
    assert balance_of(client, headers, account_id) == "950.00"


def test_confirm_skips_the_same_external_id_twice_in_one_request(client, headers, account_id):
    row = {"date": "2026-03-05", "description": "Compra", "amount": "-50.00", "external_id": "F1"}
    assert confirm(client, headers, account_id, [row, row]).json() == {"created": 1, "skipped": 1}


def test_confirm_with_rows_without_external_id_never_skips(client, headers, account_id):
    row = {"date": "2026-03-05", "description": "Cafe", "amount": "-8.00"}
    assert confirm(client, headers, account_id, [row, row]).json() == {"created": 2, "skipped": 0}
    assert confirm(client, headers, account_id, [row]).json() == {"created": 1, "skipped": 0}


def test_confirm_survives_a_concurrent_import_of_the_same_id(client, headers, account_id, monkeypatch, db_session):
    row = {"date": "2026-03-05", "description": "Compra", "amount": "-50.00", "external_id": "F1"}
    confirm(client, headers, account_id, [row])
    # Como se a outra importacao so tivesse gravado depois da checagem: a restricao do banco segura
    monkeypatch.setattr(imports_service, "_existing_external_ids", lambda *args, **kwargs: set())
    other = {"date": "2026-03-06", "description": "Outra", "amount": "-5.00", "external_id": "F2"}
    result = confirm(client, headers, account_id, [row, other]).json()
    assert result == {"created": 1, "skipped": 1}
    assert balance_of(client, headers, account_id) == "945.00"
    assert db_session.execute(select(func.count()).select_from(TransactionSplit).where(TransactionSplit.external_id == "F1")).scalar_one() == 1


def test_confirm_is_all_or_nothing_when_a_row_is_refused(client, headers, account_id, db_session):
    before = split_count(db_session)
    rows = [
        {"date": "2026-03-05", "description": "Boa", "amount": "-5.00"},
        {"date": "2026-03-05", "description": "Casas demais", "amount": "-5.001"},
    ]
    response = confirm(client, headers, account_id, rows)
    assert response.status_code in (400, 422)
    assert split_count(db_session) == before
    assert balance_of(client, headers, account_id) == "1000.00"


def test_confirm_names_the_row_when_the_amount_does_not_fit_the_currency(client, headers):
    yen = make_account(client, headers, name="Yen", currency_code="JPY", opening_balance="1000")
    rows = [
        {"date": "2026-03-05", "description": "Ramen", "amount": "-50"},
        {"date": "2026-03-05", "description": "Sushi", "amount": "-50.5"},
    ]
    response = confirm(client, headers, yen, rows)
    assert response.status_code == 400 and response.json()["code"] == "invalid_amount"
    assert response.json()["detail"].startswith("Linha 2:")
    assert balance_of(client, headers, yen) == "1000"


@pytest.mark.parametrize(
    "row",
    [
        {"date": "2026-03-05", "description": "X", "amount": "0.00"},
        {"date": "2026-03-05", "description": "", "amount": "-5.00"},
        {"date": "2026-03-05", "description": "   ", "amount": "-5.00"},
        {"date": "2026-03-05", "description": "x" * 256, "amount": "-5.00"},
        {"date": "1800-01-01", "description": "X", "amount": "-5.00"},
        {"date": "2099-01-01", "description": "X", "amount": "-5.00"},
        {"date": "05/03/2026", "description": "X", "amount": "-5.00"},
        {"date": "2026-03-05", "description": "X", "amount": "abc"},
        {"date": "2026-03-05", "description": "X"},
        {"date": "2026-03-05", "description": "X", "amount": "-5.00", "external_id": ""},
        {"date": "2026-03-05", "description": "X", "amount": "-5.00", "external_id": "i" * 256},
        {"date": "2026-03-05", "description": "X", "amount": "-5.00", "category_id": str(uuid.uuid4())},
    ],
)
def test_confirm_validates_every_row(client, headers, account_id, row):
    response = confirm(client, headers, account_id, [row])
    assert response.status_code == 422 and response.json()["code"] == "validation_error"


def test_confirm_needs_at_least_one_row_and_respects_the_row_limit(client, headers, account_id, monkeypatch):
    assert confirm(client, headers, account_id, []).status_code == 422
    monkeypatch.setattr(settings, "import_max_rows", 2)
    row = {"date": "2026-03-05", "description": "Cafe", "amount": "-8.00"}
    assert confirm(client, headers, account_id, [row, row, row]).status_code == 422
    assert confirm(client, headers, account_id, [row, row]).status_code == 201


def test_confirm_collapses_spaces_in_the_description_and_trims_the_counterparty(client, headers, account_id):
    confirm(client, headers, account_id, [{"date": "2026-03-05", "description": "  Loja    do   Ze  ", "amount": "-5.00"}])
    split = client.get(TX, params={"account_id": account_id}, headers=headers).json()["items"][0]["splits"][0]
    assert split["description"] == "Loja do Ze" and split["destination_account_name"] == "Loja do Ze"


def test_a_long_description_still_fits_the_counterparty_name(client, headers, account_id):
    description = "d" * 255
    assert confirm(client, headers, account_id, [{"date": "2026-03-05", "description": description, "amount": "-5.00"}]).status_code == 201
    split = client.get(TX, params={"account_id": account_id}, headers=headers).json()["items"][0]["splits"][0]
    assert split["description"] == description and len(split["destination_account_name"]) == 200


def test_the_two_steps_together_import_only_the_rows_the_person_kept(client, headers, account_id):
    spend(client, headers, account_id, "Mercado Bom Preco", "50.00", "2026-03-05")
    preview = upload(client, headers, account_id, CSV_TEXT).json()
    kept = [r for r in preview["rows"] if r["status"] == "new"]
    payload = [{"date": r["date"], "description": r["description"], "amount": r["amount"], "external_id": r["external_id"]} for r in kept]
    assert confirm(client, headers, account_id, payload).json() == {"created": 2, "skipped": 0}
    assert Decimal(balance_of(client, headers, account_id)) == Decimal("1000.00") - Decimal("50.00") + Decimal("1000.00") - Decimal("12.50")


def test_confirm_emits_one_webhook_event_per_created_row(client, headers, account_id, db_session, no_real_dns):
    from app.models.webhook import WebhookDelivery

    hook = {"name": "Teste", "url": "https://hooks.example.com/finance", "events": ["transaction.created"]}
    assert client.post(f"{API}/webhooks", json=hook, headers=headers).status_code == 201
    rows = [{"date": "2026-03-05", "description": f"Item {n}", "amount": "-1.00"} for n in range(3)]
    confirm(client, headers, account_id, rows)
    assert db_session.execute(select(func.count()).select_from(WebhookDelivery)).scalar_one() == 3


# ---------- Idioma (Accept-Language) ----------


def test_preview_row_reasons_in_english(client, headers, account_id):
    en_headers = {**headers, "Accept-Language": "en-US"}
    text = (
        "Data;Descricao;Valor\n"
        "31/02/2026;Data ruim;-5,00\n"
        "05/03/2026;;-5,00\n"
        "05/03/2026;Valor ruim;abc\n"
        "05/03/2026;Boa;-5,00\n"
    )
    body = upload(client, en_headers, account_id, text).json()
    assert [r["reason"] for r in body["rows"][:3]] == ["Date doesn't exist", "Description is empty", "Invalid amount"]


def test_duplicate_reason_in_english(client, headers, account_id):
    en_headers = {**headers, "Accept-Language": "en-US"}
    spend(client, headers, account_id, "Mercado Bom Preco", "50.00", "2026-03-05")
    body = upload(client, en_headers, account_id, CSV_TEXT).json()
    assert "matching transaction" in body["rows"][0]["reason"]


def test_empty_file_message_in_english(client, headers, account_id):
    en_headers = {**headers, "Accept-Language": "en-US"}
    resp = upload(client, en_headers, account_id, "")
    assert resp.status_code == 422
    assert resp.json()["detail"] == "The file is empty"
