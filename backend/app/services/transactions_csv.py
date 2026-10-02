import csv
import io
import uuid
from collections.abc import Iterator
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

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

TYPE_LABELS = {"withdrawal": "Saída", "deposit": "Entrada", "transfer": "Transferência"}

# O Excel e o LibreOffice tratam texto que comeca com estes caracteres como formula
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

UTF8_BOM = "\ufeff"


def safe_text(value: str | None) -> str:
    """Texto livre para uma celula. Se comecar como formula, ganha um apostrofo na frente para a
    planilha mostrar o texto em vez de executar. Numeros nao passam por aqui: um valor negativo
    legitimo continua numero."""
    if not value:
        return ""
    return "'" + value if value.startswith(FORMULA_PREFIXES) else value


def format_money(value: Decimal | None, decimal_places: int) -> str:
    """Valor com as casas da moeda e virgula decimal (formato do Excel em portugues), sem separador de milhar."""
    if value is None:
        return ""
    quantized = value.quantize(Decimal(10) ** -decimal_places)
    return format(quantized, "f").replace(".", ",")


def _render(rows: list[list[str]], *, with_bom: bool = False) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", quotechar='"', quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    writer.writerows(rows)
    text = buffer.getvalue()
    return (UTF8_BOM + text if with_bom else text).encode("utf-8")


def _names(db: Session, model, ids: set[uuid.UUID], user_id: uuid.UUID) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    return dict(db.execute(select(model.id, model.name).where(model.id.in_(ids), model.user_id == user_id)).all())


def export_csv_chunks(
    db: Session, user_id: uuid.UUID, filters: TransactionFilters, block_size: int | None = None
) -> Iterator[bytes]:
    """Gera o CSV aos poucos: o cabecalho (com BOM) e depois um pedaco por bloco de transacoes.
    Uma linha por split, na ordem da lista de transacoes."""
    yield _render([HEADER], with_bom=True)

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
                    TYPE_LABELS[split["type"]],
                    safe_text(split["description"]),
                    safe_text(split["source_account_name"]),
                    safe_text(split["destination_account_name"]),
                    format_money(split["amount"], places[split["currency_code"]]),
                    split["currency_code"],
                    format_money(split["foreign_amount"], places[foreign_code]) if foreign_code else "",
                    foreign_code or "",
                    safe_text(categories.get(split["category_id"])),
                    safe_text(budgets.get(split["budget_id"])),
                    safe_text(", ".join(tag_names)),
                    safe_text(split["notes"]),
                ]
            )
        yield _render(rows)
