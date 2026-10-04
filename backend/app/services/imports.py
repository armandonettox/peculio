"""Importacao de extrato (CSV e OFX): previa do que vai entrar e confirmacao.

O arquivo nunca e guardado: a previa le, compara com o que ja existe e devolve as linhas; a confirmacao
recebe de volta so as linhas marcadas e valida tudo de novo, sem confiar no que veio da tela.
"""

import uuid
from collections import Counter
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError, ErrorCode
from app.models.account import Account, AccountType
from app.models.transaction import TransactionSplit, TransactionType
from app.models.user import User
from app.schemas.imports import ImportConfirm, ImportMapping, ImportRowIn, check_import_date
from app.schemas.transaction import TransactionCreate, TransactionSplitCreate
from app.services.accounts import check_amount, get_currency, get_owned_account
from app.services.import_parsers import (
    SAMPLE_ROWS,
    ColumnMapping,
    ImportFileError,
    ParsedRow,
    decode_text,
    looks_like_ofx,
    normalize_text,
    parse_ofx,
    read_csv,
    rows_from_csv,
    suggest_mapping,
)
from app.services.clearings import mark_cleared
from app.services.transactions import create_transaction

COUNTERPARTY_MAX = 200


def _bad_file(error: ImportFileError) -> AppError:
    return AppError(422, ErrorCode.IMPORT_FILE_INVALID, str(error))


def _import_account(db: Session, user: User, account_id: uuid.UUID) -> Account:
    """So conta de ativo recebe extrato: divida nao tem entrada nem saida de dinheiro do dia a dia."""
    account = get_owned_account(db, user.id, account_id)
    if account.type != AccountType.asset:
        raise AppError(400, ErrorCode.IMPORT_ACCOUNT_INVALID, "O extrato so pode ser importado em uma conta de ativo")
    return account


def _to_mapping(mapping: ImportMapping) -> ColumnMapping:
    return ColumnMapping(**mapping.model_dump())


def _from_mapping(mapping: ColumnMapping) -> ImportMapping:
    return ImportMapping(
        date_column=mapping.date_column,
        description_column=mapping.description_column,
        amount_column=mapping.amount_column,
        debit_column=mapping.debit_column,
        credit_column=mapping.credit_column,
        has_header=mapping.has_header,
    )


def _check_row(row: ParsedRow, places_check) -> None:
    """Confere o que depende da conta (casas da moeda) e do dia (janela de datas) e guarda o motivo."""
    if row.error is not None:
        return
    try:
        check_import_date(row.date)
        places_check(abs(row.amount))
    except ValueError as error:
        row.error = str(error)
    except AppError as error:
        row.error = str(error.detail)


def _fingerprint(day: date, signed_amount, description: str) -> tuple:
    return (day, signed_amount, normalize_text(description))


def _existing_external_ids(db: Session, user_id: uuid.UUID, account_id: uuid.UUID, ids: list[str]) -> set[str]:
    if not ids:
        return set()
    return set(
        db.execute(
            select(TransactionSplit.external_id).where(
                TransactionSplit.user_id == user_id,
                TransactionSplit.external_account_id == account_id,
                TransactionSplit.external_id.in_(ids),
            )
        ).scalars()
    )


def _existing_fingerprints(db: Session, user_id: uuid.UUID, account_id: uuid.UUID, rows: list[ParsedRow]) -> Counter:
    """Quantas vezes cada (dia, valor com sinal, descricao) ja existe na conta, dentro do periodo do arquivo.
    Conta quantas vezes: dois cafes iguais no mesmo dia sao dois lancamentos, nao um repetido."""
    days = [row.date for row in rows]
    found = db.execute(
        select(TransactionSplit.date, TransactionSplit.description, TransactionSplit.amount, TransactionSplit.destination_account_id)
        .where(
            TransactionSplit.user_id == user_id,
            or_(TransactionSplit.source_account_id == account_id, TransactionSplit.destination_account_id == account_id),
            TransactionSplit.date >= min(days),
            TransactionSplit.date <= max(days),
        )
    ).all()
    counter: Counter = Counter()
    for day, description, amount, destination_id in found:
        # Entrou na conta (destino) e positivo; saiu da conta (origem) e negativo
        counter[_fingerprint(day, amount if destination_id == account_id else -amount, description)] += 1
    return counter


def _mark_duplicates(db: Session, user: User, account: Account, rows: list[ParsedRow]) -> dict[int, tuple[str, str]]:
    """Para cada linha valida que ja existe: (tipo, motivo). O tipo e same_id (o banco ja mandou esta linha,
    certeza) ou similar (ja ha um igual na conta, suspeita)."""
    valid = [row for row in rows if row.error is None]
    if not valid:
        return {}
    known_ids = _existing_external_ids(db, user.id, account.id, [row.external_id for row in valid if row.external_id])
    fingerprints = _existing_fingerprints(db, user.id, account.id, valid)
    seen_ids: set[str] = set()
    found: dict[int, tuple[str, str]] = {}
    for row in valid:
        if row.external_id:
            if row.external_id in known_ids or row.external_id in seen_ids:
                found[row.index] = ("same_id", "Este lancamento ja foi importado antes (mesmo identificador do banco)")
                continue
            seen_ids.add(row.external_id)
        key = _fingerprint(row.date, row.amount, row.description)
        if fingerprints[key] > 0:
            fingerprints[key] -= 1
            found[row.index] = ("similar", "Ja existe um lancamento igual nesta conta, no mesmo dia e com o mesmo valor")
    return found


def preview(db: Session, user: User, account_id: uuid.UUID, content: bytes, mapping: ImportMapping | None) -> dict:
    account = _import_account(db, user, account_id)
    if not content.strip():
        raise AppError(422, ErrorCode.IMPORT_FILE_INVALID, "O arquivo esta vazio")
    try:
        text = decode_text(content)
        out: dict = {"account_id": account.id, "columns": None, "sample": None, "mapping": None, "needs_mapping": False}
        if looks_like_ofx(text):
            statement = parse_ofx(text)
            if statement.currency and statement.currency != account.currency_code:
                raise ImportFileError(
                    f"O arquivo esta em {statement.currency} e a conta em {account.currency_code}: escolha uma conta na mesma moeda"
                )
            rows = statement.rows
            out["format"] = "ofx"
        else:
            table = read_csv(text, has_header=mapping.has_header if mapping else True)
            out["format"] = "csv"
            out["columns"] = table.headers
            out["sample"] = table.rows[:SAMPLE_ROWS]
            chosen = _to_mapping(mapping) if mapping else suggest_mapping(table.headers)
            if chosen is None:
                out.update(needs_mapping=True, rows=[], counts={"new": 0, "duplicate": 0, "error": 0})
                return out
            out["mapping"] = _from_mapping(chosen)
            rows = rows_from_csv(table, chosen)
    except ImportFileError as error:
        raise _bad_file(error) from error

    if not rows:
        raise AppError(422, ErrorCode.IMPORT_FILE_INVALID, "O arquivo nao tem nenhum lancamento")
    if len(rows) > settings.import_max_rows:
        raise AppError(
            422, ErrorCode.IMPORT_TOO_MANY_ROWS, f"O arquivo tem mais de {settings.import_max_rows} linhas: divida em partes"
        )

    currency = get_currency(db, account.currency_code)
    for row in rows:
        _check_row(row, lambda amount: check_amount(currency, amount))
    duplicates = _mark_duplicates(db, user, account, rows)

    items = []
    counts = {"new": 0, "duplicate": 0, "error": 0}
    for row in rows:
        kind, reason = duplicates.get(row.index, (None, None))
        status = "error" if row.error else "duplicate" if kind else "new"
        counts[status] += 1
        items.append(
            {
                "index": row.index,
                "date": row.date,
                "description": row.description,
                "amount": row.amount,
                "external_id": row.external_id,
                "status": status,
                "duplicate_kind": kind,
                "reason": row.error or reason,
            }
        )
    out.update(rows=items, counts=counts)
    return out


def _create_row(db: Session, user: User, account: Account, row: ImportRowIn) -> None:
    is_deposit = row.amount > 0
    split = TransactionSplitCreate(
        type=TransactionType.deposit if is_deposit else TransactionType.withdrawal,
        date=row.date,
        description=row.description,
        amount=abs(row.amount),
        currency_code=account.currency_code,
        account_id=account.id,
        counterparty_name=row.description[:COUNTERPARTY_MAX],
    )
    transaction = create_transaction(db, user, TransactionCreate(splits=[split]))
    if row.external_id:
        created = db.execute(select(TransactionSplit).where(TransactionSplit.transaction_id == transaction.id)).scalar_one()
        created.external_id = row.external_id
        created.external_account_id = account.id
        db.flush()
    # Veio do extrato do proprio banco: ja nasce conferido
    created = db.execute(select(TransactionSplit.id).where(TransactionSplit.transaction_id == transaction.id)).scalar_one()
    mark_cleared(db, user.id, created, account.id)


def confirm(db: Session, user: User, data: ImportConfirm) -> dict:
    account = _import_account(db, user, data.account_id)
    currency = get_currency(db, account.currency_code)
    for position, row in enumerate(data.rows, start=1):
        try:
            check_amount(currency, abs(row.amount))
        except AppError as error:
            raise AppError(error.status_code, error.code, f"Linha {position}: {error.detail}") from error

    known = _existing_external_ids(db, user.id, account.id, [row.external_id for row in data.rows if row.external_id])
    created = skipped = 0
    for row in data.rows:
        if row.external_id and row.external_id in known:
            skipped += 1
            continue
        try:
            # Savepoint por linha: se outra importacao gravou o mesmo identificador agora, so esta linha e deixada de fora
            with db.begin_nested():
                _create_row(db, user, account, row)
        except IntegrityError:
            skipped += 1
            continue
        if row.external_id:
            known.add(row.external_id)
        created += 1
    return {"created": created, "skipped": skipped}

