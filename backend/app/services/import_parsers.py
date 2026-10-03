"""Leitura de extratos (CSV e OFX) sem banco de dados: so texto entra, linhas validadas saem.

Nada aqui conhece contas ou lancamentos. O servico de importacao compara estas linhas com o que ja existe.
Mensagens de erro de cada linha ficam em portugues claro, porque aparecem na previa para a pessoa.
"""

import csv
import io
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation

# Limites que protegem o servidor de um arquivo enorme ou de lixo
MAX_DESCRIPTION = 255
# Datas fora desta janela quase sempre sao erro de leitura (ex: 01/01/0001)
MIN_YEAR = 1990
# Linhas de amostra que a tela mostra para a pessoa escolher as colunas
SAMPLE_ROWS = 5

DELIMITERS = (";", ",", "\t", "|")


class ImportFileError(Exception):
    """O arquivo inteiro nao serve (vazio, binario, sem lancamentos...)."""


@dataclass
class ParsedRow:
    # Numero da linha como a pessoa conta no arquivo (a primeira linha e 1)
    index: int
    date: date | None = None
    description: str = ""
    # Com sinal: negativo e saida, positivo e entrada
    amount: Decimal | None = None
    external_id: str | None = None
    error: str | None = None


@dataclass
class ColumnMapping:
    """Qual coluna do CSV e o que. As colunas contam a partir de 0. Valor: ou uma coluna com sinal, ou
    duas colunas (debito e credito)."""

    date_column: int
    description_column: int
    amount_column: int | None = None
    debit_column: int | None = None
    credit_column: int | None = None
    has_header: bool = True


@dataclass
class CsvTable:
    headers: list[str]
    rows: list[list[str]]
    # Linha do arquivo de cada linha de `rows` (a primeira linha do arquivo e 1)
    line_numbers: list[int] = field(default_factory=list)


@dataclass
class OfxStatement:
    currency: str | None
    rows: list[ParsedRow]


# ---------- Texto ----------


def decode_text(content: bytes) -> str:
    """UTF-8 (com ou sem BOM); se nao for, Windows-1252, que e o que os bancos brasileiros mais mandam."""
    if b"\x00" in content:
        raise ImportFileError("O arquivo nao parece ser um extrato em texto")
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return content.decode("cp1252", errors="replace")


def normalize_text(text: str) -> str:
    """Minusculo, sem acento e com espacos juntos: serve para comparar descricoes e nomes de coluna."""
    decomposed = unicodedata.normalize("NFKD", text)
    plain = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(plain.lower().split())


# ---------- Valor e data ----------

_AMOUNT_JUNK = re.compile(r"(?i)(r\$|us\$|\$|eur|brl|usd|\s)")


def parse_amount(text: str) -> Decimal:
    """Aceita 1.234,56 e 1234.56, sinal na frente ou atras, parenteses como negativo e simbolo de moeda.
    Mais de 2 casas decimais e recusado (nao arredonda calado)."""
    raw = _AMOUNT_JUNK.sub("", text.strip())
    if not raw:
        raise ValueError("Valor vazio")
    negative = False
    if raw.startswith("(") and raw.endswith(")"):
        negative, raw = True, raw[1:-1]
    if raw.endswith("-"):
        negative, raw = True, raw[:-1]
    if raw.startswith("-"):
        negative, raw = True, raw[1:]
    elif raw.startswith("+"):
        raw = raw[1:]
    if not raw or not re.fullmatch(r"[0-9.,]+", raw):
        raise ValueError("Valor invalido")

    last_dot, last_comma = raw.rfind("."), raw.rfind(",")
    if last_dot >= 0 and last_comma >= 0:
        # Os dois aparecem: o que vem por ultimo e o decimal, o outro separa milhares
        decimal_sep = "." if last_dot > last_comma else ","
    elif last_comma >= 0 or last_dot >= 0:
        sep = "," if last_comma >= 0 else "."
        groups = raw.split(sep)
        # Mais de um igual (1.234.567) so pode ser milhar. Um so e milhar quando o ultimo grupo tem 3 digitos e o
        # primeiro tem de 1 a 3 sem zero na frente ("1.234"); "0,001" e "1234,567" sao decimais (e passam de 2 casas).
        thousands = len(groups[-1]) == 3 and 1 <= len(groups[0]) <= 3 and not groups[0].startswith("0")
        if len(groups) > 2 and not (thousands and all(len(group) == 3 for group in groups[1:])):
            raise ValueError("Valor invalido")
        decimal_sep = None if thousands else sep
    else:
        decimal_sep = None

    if decimal_sep is None:
        digits = raw.replace(".", "").replace(",", "")
    else:
        whole, _, fraction = raw.rpartition(decimal_sep)
        digits = f"{whole.replace('.', '').replace(',', '')}.{fraction}"
    try:
        value = Decimal(digits)
    except InvalidOperation as error:
        raise ValueError("Valor invalido") from error
    if value.as_tuple().exponent < -2:
        raise ValueError("Valor com mais de 2 casas decimais")
    return -value if negative else value


_DATE_PATTERNS = (
    (re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})"), ("y", "m", "d")),
    (re.compile(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})"), ("d", "m", "y")),
    (re.compile(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})"), ("d", "m", "y2")),
    (re.compile(r"(\d{4})(\d{2})(\d{2})"), ("y", "m", "d")),
)


def parse_date(text: str) -> date:
    """aaaa-mm-dd, dd/mm/aaaa (barra, ponto ou hifen), dd/mm/aa e aaaammdd. Mes antes do dia nao e aceito."""
    raw = text.strip()
    # Data com hora ("2026-03-05 10:30" ou "05/03/2026 10:30"): so o dia importa
    raw = re.split(r"[ T]", raw, maxsplit=1)[0]
    for pattern, order in _DATE_PATTERNS:
        match = pattern.fullmatch(raw)
        if not match:
            continue
        parts = dict(zip(order, (int(group) for group in match.groups())))
        year = parts.get("y")
        if year is None:
            year = 2000 + parts["y2"]
        try:
            result = date(year, parts["m"], parts["d"])
        except ValueError as error:
            raise ValueError("Data inexistente") from error
        if result.year < MIN_YEAR:
            raise ValueError("Data fora do intervalo")
        return result
    raise ValueError("Data invalida")


# ---------- CSV ----------


def detect_delimiter(text: str) -> str:
    """O separador que mais aparece na primeira linha com conteudo (o padrao e a virgula)."""
    for line in text.splitlines():
        if line.strip():
            counts = {delimiter: line.count(delimiter) for delimiter in DELIMITERS}
            best = max(DELIMITERS, key=lambda delimiter: counts[delimiter])
            return best if counts[best] > 0 else ","
    return ","


def read_csv(text: str, has_header: bool = True) -> CsvTable:
    """Le o CSV em linhas de texto, pulando as linhas em branco. Se nao ha cabecalho, as colunas ficam
    com nomes "Coluna 1", "Coluna 2"..."""
    reader = csv.reader(io.StringIO(text), delimiter=detect_delimiter(text))
    rows: list[list[str]] = []
    numbers: list[int] = []
    try:
        for record in reader:
            if any(cell.strip() for cell in record):
                rows.append([cell.strip() for cell in record])
                # Linha do arquivo em que o registro termina (com quebra de linha entre aspas ocupa varias)
                numbers.append(reader.line_num)
    except csv.Error as error:
        raise ImportFileError("O arquivo CSV esta mal formado") from error
    if not rows:
        raise ImportFileError("O arquivo esta vazio")
    width = max(len(row) for row in rows)
    if has_header:
        headers = rows[0] + [""] * (width - len(rows[0]))
        return CsvTable(headers=headers, rows=rows[1:], line_numbers=numbers[1:])
    return CsvTable(headers=[f"Coluna {n}" for n in range(1, width + 1)], rows=rows, line_numbers=numbers)


_DATE_NAMES = ("data", "date", "dt", "dia")
_DESCRIPTION_NAMES = ("descri", "historico", "memo", "lancamento", "estabelecimento", "detalhe", "name", "nome")
_AMOUNT_NAMES = ("valor", "amount", "montante", "quantia")
_DEBIT_NAMES = ("debito", "saida", "debit", "pagamento")
_CREDIT_NAMES = ("credito", "entrada", "credit", "recebimento")


def _find(headers: list[str], names: tuple[str, ...], taken: set[int]) -> int | None:
    for index, header in enumerate(headers):
        if index in taken:
            continue
        normalized = normalize_text(header)
        if any(name in normalized for name in names):
            return index
    return None


def suggest_mapping(headers: list[str]) -> ColumnMapping | None:
    """Adivinha as colunas pelo nome do cabecalho. Devolve None se nao achar data, descricao e valor."""
    taken: set[int] = set()
    date_column = _find(headers, _DATE_NAMES, taken)
    if date_column is None:
        return None
    taken.add(date_column)
    description_column = _find(headers, _DESCRIPTION_NAMES, taken)
    if description_column is None:
        return None
    taken.add(description_column)
    amount_column = _find(headers, _AMOUNT_NAMES, taken)
    if amount_column is not None:
        return ColumnMapping(date_column, description_column, amount_column=amount_column)
    debit = _find(headers, _DEBIT_NAMES, taken)
    credit = _find(headers, _CREDIT_NAMES, taken | ({debit} if debit is not None else set()))
    if debit is not None and credit is not None:
        return ColumnMapping(date_column, description_column, debit_column=debit, credit_column=credit)
    return None


def check_mapping(mapping: ColumnMapping, width: int) -> None:
    """A escolha de colunas tem que fazer sentido para este arquivo."""
    chosen = [mapping.date_column, mapping.description_column]
    has_single = mapping.amount_column is not None
    has_pair = mapping.debit_column is not None and mapping.credit_column is not None
    if has_single == has_pair or (mapping.debit_column is None) != (mapping.credit_column is None):
        raise ImportFileError("Escolha uma coluna de valor, ou as colunas de debito e credito")
    chosen += [mapping.amount_column] if has_single else [mapping.debit_column, mapping.credit_column]
    if any(column < 0 or column >= width for column in chosen):
        raise ImportFileError("Uma das colunas escolhidas nao existe no arquivo")
    if len(set(chosen)) != len(chosen):
        raise ImportFileError("Cada informacao precisa de uma coluna diferente")


def _cell(row: list[str], column: int | None) -> str:
    if column is None or column >= len(row):
        return ""
    return row[column].strip()


def _row_amount(row: list[str], mapping: ColumnMapping) -> Decimal:
    if mapping.amount_column is not None:
        value = parse_amount(_cell(row, mapping.amount_column))
    else:
        debit, credit = _cell(row, mapping.debit_column), _cell(row, mapping.credit_column)
        if not debit and not credit:
            raise ValueError("Valor vazio")
        # Debito e saida e credito e entrada, qualquer que seja o sinal escrito no arquivo
        value = (abs(parse_amount(credit)) if credit else Decimal(0)) - (abs(parse_amount(debit)) if debit else Decimal(0))
    if value == 0:
        raise ValueError("Valor zero")
    return value


def rows_from_csv(table: CsvTable, mapping: ColumnMapping) -> list[ParsedRow]:
    """Uma ParsedRow por linha do arquivo, com o motivo no `error` quando a linha nao serve."""
    width = max([len(table.headers), *(len(row) for row in table.rows)])
    check_mapping(mapping, width)
    parsed = []
    for row, line_number in zip(table.rows, table.line_numbers):
        item = ParsedRow(index=line_number)
        try:
            item.date = parse_date(_cell(row, mapping.date_column))
            item.description = " ".join(_cell(row, mapping.description_column).split())[:MAX_DESCRIPTION]
            if not item.description:
                raise ValueError("Descricao vazia")
            item.amount = _row_amount(row, mapping)
        except ValueError as error:
            item.error = str(error)
        parsed.append(item)
    return parsed


# ---------- OFX ----------

_OFX_BLOCK = re.compile(r"(?is)<STMTTRN>(.*?)</STMTTRN>")


def looks_like_ofx(text: str) -> bool:
    head = text[:2000].upper()
    return "OFXHEADER" in head or "<OFX>" in head


def _tag(block: str, name: str) -> str | None:
    # Funciona no OFX 1.x (sem tag de fechamento) e no 2.x (XML): o valor vai ate a proxima tag ou quebra de linha
    match = re.search(rf"(?is)<{name}>\s*([^<\r\n]*)", block)
    return match.group(1).strip() if match else None


def _unescape(text: str) -> str:
    return text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'")


def parse_ofx(text: str) -> OfxStatement:
    blocks = _OFX_BLOCK.findall(text)
    if not blocks:
        raise ImportFileError("Nenhum lancamento encontrado no arquivo OFX")
    currency = _tag(text, "CURDEF")
    rows = []
    for number, block in enumerate(blocks, start=1):
        item = ParsedRow(index=number)
        try:
            posted = _tag(block, "DTPOSTED")
            if not posted:
                raise ValueError("Data vazia")
            # A data do OFX e aaaammdd, com hora e fuso depois: so o dia importa
            item.date = parse_date(posted[:8])
            amount_text = _tag(block, "TRNAMT")
            if not amount_text:
                raise ValueError("Valor vazio")
            item.amount = parse_amount(amount_text)
            if item.amount == 0:
                raise ValueError("Valor zero")
            name, memo = _unescape(_tag(block, "NAME") or ""), _unescape(_tag(block, "MEMO") or "")
            # NAME e MEMO costumam repetir o mesmo texto: so junta quando dizem coisas diferentes
            parts = [name] if not memo or normalize_text(memo) == normalize_text(name) else [name, memo]
            item.description = " ".join(" ".join(part for part in parts if part).split())[:MAX_DESCRIPTION]
            if not item.description:
                raise ValueError("Descricao vazia")
            fitid = _tag(block, "FITID")
            item.external_id = fitid[:255] if fitid else None
        except ValueError as error:
            item.error = str(error)
        rows.append(item)
    return OfxStatement(currency=currency.upper() if currency else None, rows=rows)
