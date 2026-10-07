import csv
import io
import uuid
from collections.abc import Iterator
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.i18n import Lang
from app.models.budget import Budget
from app.models.category import Category
from app.models.currency import Currency
from app.models.tag import Tag
from app.services.transactions import TransactionFilters, iter_transaction_blocks

# Quantos grupos de transacao saem em cada bloco do arquivo
BLOCK_SIZE = 200

HEADER = [
    "data",
    "tipo",
    "descricao",
    "conta_origem",
    "conta_destino",
    "valor",
    "moeda",
    "valor_estrangeiro",
    "moeda_estrangeira",
    "categoria",
    "orcamento",
    "tags",
    "notas",
]

HEADER_EN = [
    "date",
    "type",
    "description",
    "source_account",
    "destination_account",
    "amount",
    "currency",
    "foreign_amount",
    "foreign_currency",
    "category",
    "budget",
    "tags",
    "notes",
]


def header_for(lang: Lang) -> list[str]:
    return HEADER if lang == "pt-BR" else HEADER_EN


TYPE_LABELS = {"withdrawal": "Saída", "deposit": "Entrada", "transfer": "Transferência"}
TYPE_LABELS_EN = {"withdrawal": "Expense", "deposit": "Income", "transfer": "Transfer"}


def type_labels_for(lang: Lang) -> dict[str, str]:
    return TYPE_LABELS if lang == "pt-BR" else TYPE_LABELS_EN


# O separador e a casa decimal seguem o costume de cada idioma: ; e virgula no Brasil (o Excel em
# portugues usa a virgula do sistema operacional como separador decimal, e trataria uma virgula de
# milhar como separador de coluna), , e ponto no resto do mundo.
def delimiter_for(lang: Lang) -> str:
    return ";" if lang == "pt-BR" else ","


# O Excel e o LibreOffice tratam texto que comeca com estes caracteres como formula
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

UTF8_BOM = "﻿"


def safe_text(value: str | None) -> str:
    """Texto livre para uma celula. Se comecar como formula, ganha um apostrofo na frente para a
    planilha mostrar o texto em vez de executar. Numeros nao passam por aqui: um valor negativo
    legitimo continua numero."""
    if not value:
        return ""
    return "'" + value if value.startswith(FORMULA_PREFIXES) else value


def format_money(value: Decimal | None, decimal_places: int, lang: Lang = "pt-BR") -> str:
    """Valor com as casas da moeda, na pontuacao do idioma: virgula decimal em portugues, ponto em ingles,
    sem separador de milhar nos dois."""
    if value is None:
        return ""
    quantized = value.quantize(Decimal(10) ** -decimal_places)
    text = format(quantized, "f")
    return text.replace(".", ",") if lang == "pt-BR" else text


def _render(rows: list[list[str]], delimiter: str, *, with_bom: bool = False) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=delimiter, quotechar='"', quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    writer.writerows(rows)
    text = buffer.getvalue()
    return (UTF8_BOM + text if with_bom else text).encode("utf-8")


def _names(db: Session, model, ids: set[uuid.UUID], user_id: uuid.UUID) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    return dict(db.execute(select(model.id, model.name).where(model.id.in_(ids), model.user_id == user_id)).all())


def export_csv_chunks(
    db: Session, user_id: uuid.UUID, filters: TransactionFilters, block_size: int | None = None, lang: Lang = "pt-BR"
) -> Iterator[bytes]:
    """Gera o CSV aos poucos: o cabecalho (com BOM) e depois um pedaco por bloco de transacoes.
    Uma linha por split, na ordem da lista de transacoes."""
    delimiter = delimiter_for(lang)
    type_labels = type_labels_for(lang)
    yield _render([header_for(lang)], delimiter, with_bom=True)

    places = dict(db.execute(select(Currency.code, Currency.decimal_places)).all())
    for block in iter_transaction_blocks(db, user_id, filters, block_size or BLOCK_SIZE):
        splits = [split for transaction in block for split in transaction["splits"]]
        categories = _names(db, Category, {s["category_id"] for s in splits if s["category_id"]}, user_id)
        budgets = _names(db, Budget, {s["budget_id"] for s in splits if s["budget_id"]}, user_id)
        tags = _names(db, Tag, {tag_id for s in splits for tag_id in s["tag_ids"]}, user_id)

        rows = []
        for split in splits:
            foreign_code = split["foreign_currency_code"]
            tag_names = sorted((tags[tag_id] for tag_id in split["tag_ids"]), key=str.lower)
            rows.append(
                [
                    split["date"].isoformat(),
                    type_labels[split["type"]],
                    safe_text(split["description"]),
                    safe_text(split["source_account_name"]),
                    safe_text(split["destination_account_name"]),
                    format_money(split["amount"], places[split["currency_code"]], lang),
                    split["currency_code"],
                    format_money(split["foreign_amount"], places[foreign_code], lang) if foreign_code else "",
                    foreign_code or "",
                    safe_text(categories.get(split["category_id"])),
                    safe_text(budgets.get(split["budget_id"])),
                    safe_text(", ".join(tag_names)),
                    safe_text(split["notes"]),
                ]
            )
        yield _render(rows, delimiter)
