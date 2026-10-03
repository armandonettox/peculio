from datetime import date
from decimal import Decimal

import pytest

from app.services.import_parsers import (
    ColumnMapping,
    ImportFileError,
    check_mapping,
    decode_text,
    detect_delimiter,
    looks_like_ofx,
    normalize_text,
    parse_amount,
    parse_date,
    parse_ofx,
    read_csv,
    rows_from_csv,
    suggest_mapping,
)

# Letras com acento montadas por codigo: o arquivo de teste fica so em ASCII
CEDILLA, ATILDE, EACUTE = chr(231), chr(227), chr(233)


# ---------- Valor ----------


@pytest.mark.parametrize(
    "text, expected",
    [
        ("1234.56", "1234.56"),
        ("1.234,56", "1234.56"),
        ("1,234.56", "1234.56"),
        ("12,5", "12.5"),
        ("12.5", "12.5"),
        ("0,50", "0.50"),
        (".5", "0.5"),
        ("1.234", "1234"),
        ("1,234", "1234"),
        ("1.234.567", "1234567"),
        ("1.234.567,89", "1234567.89"),
        ("50", "50"),
        ("-50,00", "-50.00"),
        ("+50,00", "50.00"),
        ("50,00-", "-50.00"),
        ("(12,50)", "-12.50"),
        ("R$ 1.234,56", "1234.56"),
        ("-R$ 50,00", "-50.00"),
        ("  42,10  ", "42.10"),
        ("US$ 9.99", "9.99"),
    ],
)
def test_parse_amount_accepts_the_usual_formats(text, expected):
    assert parse_amount(text) == Decimal(expected)


@pytest.mark.parametrize(
    "text, message",
    [
        ("", "Valor vazio"),
        ("   ", "Valor vazio"),
        ("R$", "Valor vazio"),
        ("abc", "Valor invalido"),
        ("12a", "Valor invalido"),
        ("--5", "Valor invalido"),
        ("12.345,678", "Valor com mais de 2 casas decimais"),
        ("0,001", "Valor com mais de 2 casas decimais"),
        ("1234,567", "Valor com mais de 2 casas decimais"),
        ("1.23.4", "Valor invalido"),
        ("1,5,6", "Valor invalido"),
        ("-", "Valor invalido"),
        ("()", "Valor invalido"),
    ],
)
def test_parse_amount_refuses_what_it_cannot_read(text, message):
    with pytest.raises(ValueError, match=message):
        parse_amount(text)


def test_a_value_with_three_digits_after_the_separator_is_thousands_not_decimals():
    # "1.234" e mil duzentos e trinta e quatro, nunca 1,234 (que passaria de 2 casas)
    assert parse_amount("1.234") == Decimal("1234")


# ---------- Data ----------


@pytest.mark.parametrize(
    "text, expected",
    [
        ("2026-03-05", date(2026, 3, 5)),
        ("2026-3-5", date(2026, 3, 5)),
        ("05/03/2026", date(2026, 3, 5)),
        ("5/3/2026", date(2026, 3, 5)),
        ("05-03-2026", date(2026, 3, 5)),
        ("05.03.2026", date(2026, 3, 5)),
        ("05/03/26", date(2026, 3, 5)),
        ("20260305", date(2026, 3, 5)),
        ("2026-03-05 10:30", date(2026, 3, 5)),
        ("2026-03-05T10:30:00", date(2026, 3, 5)),
        ("05/03/2026 10:30:15", date(2026, 3, 5)),
        ("  05/03/2026  ", date(2026, 3, 5)),
        ("29/02/2028", date(2028, 2, 29)),
    ],
)
def test_parse_date_accepts_the_usual_formats(text, expected):
    assert parse_date(text) == expected


@pytest.mark.parametrize(
    "text, message",
    [
        ("", "Data invalida"),
        ("ontem", "Data invalida"),
        ("2026/03/05", "Data invalida"),
        ("31/02/2026", "Data inexistente"),
        ("29/02/2027", "Data inexistente"),
        ("2026-13-01", "Data inexistente"),
        ("00/03/2026", "Data inexistente"),
        ("01/01/0001", "Data fora do intervalo"),
        ("01/01/1989", "Data fora do intervalo"),
    ],
)
def test_parse_date_refuses_what_it_cannot_read(text, message):
    with pytest.raises(ValueError, match=message):
        parse_date(text)


def test_the_month_never_comes_before_the_day():
    # 03/05/2026 e 3 de maio; nunca 5 de marco
    assert parse_date("03/05/2026") == date(2026, 5, 3)


def test_the_first_accepted_year_is_1990():
    assert parse_date("01/01/1990") == date(1990, 1, 1)


# ---------- Texto ----------


def test_decode_text_reads_utf8_with_and_without_bom():
    text = f"descri{CEDILLA}{ATILDE}o"
    assert decode_text(text.encode("utf-8")) == text
    assert decode_text(b"\xef\xbb\xbf" + text.encode("utf-8")) == text


def test_decode_text_falls_back_to_windows_1252():
    raw = f"caf{EACUTE}".encode("cp1252")
    assert decode_text(raw) == f"caf{EACUTE}"


def test_decode_text_refuses_binary():
    with pytest.raises(ImportFileError):
        decode_text(b"%PDF-1.4\x00\x01\x02")


def test_normalize_text_drops_accents_case_and_extra_spaces():
    assert normalize_text(f"  Padaria   P{ATILDE}o  Quente ") == "padaria pao quente"


# ---------- CSV ----------


@pytest.mark.parametrize(
    "line, expected",
    [
        ("a;b;c", ";"),
        ("a,b,c", ","),
        ("a\tb\tc", "\t"),
        ("a|b|c", "|"),
        ("a;b,c;d", ";"),
        ("sem separador", ","),
    ],
)
def test_detect_delimiter_picks_the_most_frequent_one(line, expected):
    assert detect_delimiter(line) == expected


def test_detect_delimiter_looks_at_the_first_line_with_content():
    assert detect_delimiter("\n\n  \na;b;c\n1,2,3") == ";"


def test_read_csv_with_header_skips_blank_lines_and_numbers_the_lines():
    table = read_csv("data;descricao;valor\n\n05/03/2026;Mercado;-50,00\n   \n06/03/2026;Salario;1000,00\n")
    assert table.headers == ["data", "descricao", "valor"]
    assert table.rows == [["05/03/2026", "Mercado", "-50,00"], ["06/03/2026", "Salario", "1000,00"]]
    assert table.line_numbers == [3, 5]


def test_read_csv_without_header_names_the_columns():
    table = read_csv("05/03/2026;Mercado;-50,00\n", has_header=False)
    assert table.headers == ["Coluna 1", "Coluna 2", "Coluna 3"]
    assert table.rows == [["05/03/2026", "Mercado", "-50,00"]]
    assert table.line_numbers == [1]


def test_read_csv_keeps_a_quoted_delimiter_and_a_quoted_line_break():
    table = read_csv('data;descricao;valor\n05/03/2026;"Loja; matriz";-50,00\n06/03/2026;"linha 1\nlinha 2";-5,00\n')
    assert table.rows[0][1] == "Loja; matriz"
    assert table.rows[1][1] == "linha 1\nlinha 2"
    # O registro com quebra comeca na linha 3 e termina na 4
    assert table.line_numbers == [2, 4]


def test_read_csv_trims_the_cells():
    table = read_csv("a;b\n  x  ;  y  \n")
    assert table.rows == [["x", "y"]]


def test_read_csv_pads_the_header_when_a_row_is_wider():
    table = read_csv("a;b\n1;2;3\n")
    assert table.headers == ["a", "b", ""]


@pytest.mark.parametrize("text", ["", "   \n\n  \n", ";;;\n;;;\n"])
def test_read_csv_refuses_an_empty_file(text):
    with pytest.raises(ImportFileError, match="vazio"):
        read_csv(text)


def test_read_csv_only_header_has_no_rows():
    table = read_csv("data;descricao;valor\n")
    assert table.rows == [] and table.line_numbers == []


# ---------- Adivinhar colunas ----------


def test_suggest_mapping_by_header_names_with_one_amount_column():
    mapping = suggest_mapping(["Data", f"Descri{CEDILLA}{ATILDE}o", "Valor"])
    assert mapping == ColumnMapping(date_column=0, description_column=1, amount_column=2)


def test_suggest_mapping_with_debit_and_credit_columns():
    mapping = suggest_mapping(["Data", f"Hist{chr(243)}rico", f"D{EACUTE}bito", f"Cr{EACUTE}dito"])
    assert mapping == ColumnMapping(date_column=0, description_column=1, debit_column=2, credit_column=3)


def test_suggest_mapping_prefers_a_single_amount_column_over_debit_and_credit():
    mapping = suggest_mapping(["Date", "Memo", "Amount", "Debit", "Credit"])
    assert mapping.amount_column == 2 and mapping.debit_column is None


def test_suggest_mapping_does_not_use_one_column_twice():
    mapping = suggest_mapping(["Data do lancamento", "Data", "Descricao", "Valor"])
    assert mapping.date_column == 0 and mapping.description_column == 2 and mapping.amount_column == 3


@pytest.mark.parametrize(
    "headers",
    [
        ["Coluna 1", "Coluna 2", "Coluna 3"],
        ["Data", "Valor"],
        ["Descricao", "Valor"],
        ["Data", "Descricao"],
        ["Data", "Descricao", "Debito"],
        ["Data", "Descricao", "Credito"],
        [],
    ],
)
def test_suggest_mapping_gives_up_when_it_cannot_find_everything(headers):
    assert suggest_mapping(headers) is None


# ---------- Conferir a escolha de colunas ----------


def test_check_mapping_accepts_a_valid_choice():
    check_mapping(ColumnMapping(0, 1, amount_column=2), width=3)
    check_mapping(ColumnMapping(0, 1, debit_column=2, credit_column=3), width=4)


@pytest.mark.parametrize(
    "mapping, width, message",
    [
        (ColumnMapping(0, 1), 3, "coluna de valor"),
        (ColumnMapping(0, 1, amount_column=2, debit_column=3, credit_column=4), 5, "coluna de valor"),
        (ColumnMapping(0, 1, debit_column=2), 3, "coluna de valor"),
        (ColumnMapping(0, 1, amount_column=2, debit_column=3), 4, "coluna de valor"),
        (ColumnMapping(0, 1, amount_column=3), 3, "nao existe"),
        (ColumnMapping(5, 1, amount_column=2), 3, "nao existe"),
        (ColumnMapping(0, 1, debit_column=2, credit_column=9), 3, "nao existe"),
        (ColumnMapping(0, 0, amount_column=2), 3, "diferente"),
        (ColumnMapping(0, 1, amount_column=1), 3, "diferente"),
        (ColumnMapping(0, 1, debit_column=2, credit_column=2), 3, "diferente"),
    ],
)
def test_check_mapping_refuses_a_choice_that_does_not_fit(mapping, width, message):
    with pytest.raises(ImportFileError, match=message):
        check_mapping(mapping, width)


# ---------- Linhas do CSV ----------


def rows_of(text, mapping, has_header=True):
    return rows_from_csv(read_csv(text, has_header=has_header), mapping)


def test_rows_from_csv_with_a_signed_amount_column():
    rows = rows_of(
        "data;descricao;valor\n05/03/2026;Mercado;-50,00\n06/03/2026;Salario;1.000,00\n",
        ColumnMapping(0, 1, amount_column=2),
    )
    assert [(r.index, r.date, r.description, r.amount, r.error) for r in rows] == [
        (2, date(2026, 3, 5), "Mercado", Decimal("-50.00"), None),
        (3, date(2026, 3, 6), "Salario", Decimal("1000.00"), None),
    ]
    assert all(r.external_id is None for r in rows)


def test_rows_from_csv_with_debit_and_credit_columns():
    rows = rows_of(
        "data;hist;deb;cred\n05/03/2026;Mercado;50,00;\n06/03/2026;Salario;;1000,00\n07/03/2026;Estorno;-30,00;\n",
        ColumnMapping(0, 1, debit_column=2, credit_column=3),
    )
    # Debito e saida e credito e entrada, qualquer que seja o sinal escrito
    assert [r.amount for r in rows] == [Decimal("-50.00"), Decimal("1000.00"), Decimal("-30.00")]


def test_rows_from_csv_with_both_debit_and_credit_filled_nets_them():
    rows = rows_of("d;h;deb;cred\n05/03/2026;X;10,00;25,00\n", ColumnMapping(0, 1, debit_column=2, credit_column=3))
    assert rows[0].amount == Decimal("15.00")


def test_rows_from_csv_debit_and_credit_both_empty_is_an_error():
    rows = rows_of("d;h;deb;cred\n05/03/2026;X;;\n", ColumnMapping(0, 1, debit_column=2, credit_column=3))
    assert rows[0].error == "Valor vazio" and rows[0].amount is None


def test_rows_from_csv_debit_and_credit_that_cancel_out_is_a_zero_error():
    rows = rows_of("d;h;deb;cred\n05/03/2026;X;10,00;10,00\n", ColumnMapping(0, 1, debit_column=2, credit_column=3))
    assert rows[0].error == "Valor zero"


def test_rows_from_csv_gives_each_bad_row_its_own_reason_without_stopping():
    rows = rows_of(
        "data;descricao;valor\n"
        "31/02/2026;Data ruim;-5,00\n"
        "05/03/2026;;-5,00\n"
        "05/03/2026;Valor ruim;abc\n"
        "05/03/2026;Valor zero;0,00\n"
        "05/03/2026;Boa;-5,00\n",
        ColumnMapping(0, 1, amount_column=2),
    )
    assert [r.error for r in rows] == ["Data inexistente", "Descricao vazia", "Valor invalido", "Valor zero", None]
    assert rows[4].amount == Decimal("-5.00")


def test_rows_from_csv_a_short_row_reports_the_missing_cell():
    rows = rows_of("data;descricao;valor\n05/03/2026;Mercado\n", ColumnMapping(0, 1, amount_column=2))
    assert rows[0].error == "Valor vazio"


def test_rows_from_csv_collapses_spaces_and_caps_the_description():
    long_text = "x" * 300
    rows = rows_of(f"d;h;v\n05/03/2026;  Loja    do   Ze  ;-5,00\n05/03/2026;{long_text};-5,00\n", ColumnMapping(0, 1, amount_column=2))
    assert rows[0].description == "Loja do Ze"
    assert len(rows[1].description) == 255


def test_rows_from_csv_without_header_uses_the_columns_by_position():
    rows = rows_of("05/03/2026;Mercado;-50,00\n", ColumnMapping(0, 1, amount_column=2, has_header=False), has_header=False)
    assert rows[0].index == 1 and rows[0].amount == Decimal("-50.00")


def test_rows_from_csv_checks_the_mapping_first():
    with pytest.raises(ImportFileError):
        rows_of("data;descricao;valor\n05/03/2026;Mercado;-50,00\n", ColumnMapping(0, 1, amount_column=7))


# ---------- OFX ----------

OFX_SGML = """OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260305120000[-3:BRT]
<TRNAMT>-50.00
<FITID>2026030501
<MEMO>COMPRA MERCADO
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260306
<TRNAMT>1000.00
<FITID>2026030601
<NAME>SALARIO
<MEMO>EMPRESA EXEMPLO
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
"""

OFX_XML = """<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD</CURDEF><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260305</DTPOSTED><TRNAMT>-12.34</TRNAMT><FITID>A1</FITID><NAME>Caf&amp;Co</NAME><MEMO>Caf&amp;Co</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
"""


def test_looks_like_ofx_by_header_or_root_tag():
    assert looks_like_ofx(OFX_SGML) and looks_like_ofx(OFX_XML)
    assert looks_like_ofx("lixo\n<ofx>\n")
    assert not looks_like_ofx("data;descricao;valor\n05/03/2026;Mercado;-50,00\n")


def test_parse_ofx_reads_the_old_sgml_format():
    statement = parse_ofx(OFX_SGML)
    assert statement.currency == "BRL"
    assert [(r.index, r.date, r.description, r.amount, r.external_id, r.error) for r in statement.rows] == [
        (1, date(2026, 3, 5), "COMPRA MERCADO", Decimal("-50.00"), "2026030501", None),
        (2, date(2026, 3, 6), "SALARIO EMPRESA EXEMPLO", Decimal("1000.00"), "2026030601", None),
    ]


def test_parse_ofx_reads_the_xml_format_and_unescapes_text():
    statement = parse_ofx(OFX_XML)
    assert statement.currency == "USD"
    # NAME e MEMO iguais so contam uma vez
    assert [(r.description, r.amount, r.external_id) for r in statement.rows] == [("Caf&Co", Decimal("-12.34"), "A1")]


def test_parse_ofx_uses_only_the_day_of_the_posted_date():
    statement = parse_ofx(OFX_SGML)
    assert statement.rows[0].date == date(2026, 3, 5)


def test_parse_ofx_without_name_or_memo_is_an_error_row():
    text = OFX_SGML.replace("<MEMO>COMPRA MERCADO\n", "")
    statement = parse_ofx(text)
    assert statement.rows[0].error == "Descricao vazia"
    assert statement.rows[1].error is None


@pytest.mark.parametrize(
    "old, new, message",
    [
        ("<DTPOSTED>20260305120000[-3:BRT]\n", "", "Data vazia"),
        ("<DTPOSTED>20260305120000[-3:BRT]", "<DTPOSTED>2026XXXX", "Data invalida"),
        ("<TRNAMT>-50.00\n", "", "Valor vazio"),
        ("<TRNAMT>-50.00", "<TRNAMT>0.00", "Valor zero"),
        ("<TRNAMT>-50.00", "<TRNAMT>abc", "Valor invalido"),
    ],
)
def test_parse_ofx_marks_a_bad_transaction_without_losing_the_others(old, new, message):
    statement = parse_ofx(OFX_SGML.replace(old, new))
    assert statement.rows[0].error == message
    assert statement.rows[1].error is None


def test_parse_ofx_transaction_without_fitid_has_no_external_id():
    statement = parse_ofx(OFX_SGML.replace("<FITID>2026030501\n", ""))
    assert statement.rows[0].external_id is None and statement.rows[0].error is None


def test_parse_ofx_without_currency_returns_none():
    assert parse_ofx(OFX_SGML.replace("<CURDEF>BRL\n", "")).currency is None


def test_parse_ofx_without_any_transaction_is_a_file_error():
    with pytest.raises(ImportFileError, match="Nenhum lancamento"):
        parse_ofx("OFXHEADER:100\n<OFX></OFX>")


def test_parse_ofx_is_case_insensitive_about_tags():
    statement = parse_ofx(OFX_SGML.lower().replace("ofxheader", "OFXHEADER"))
    assert len(statement.rows) == 2 and statement.rows[0].amount == Decimal("-50.00")
