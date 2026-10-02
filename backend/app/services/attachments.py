import hashlib
import os
import re
import unicodedata
import uuid
from pathlib import Path
from typing import BinaryIO

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError, ErrorCode
from app.models.attachment import Attachment
from app.models.transaction import Transaction, TransactionSplit
from app.models.user import User
from app.services.attachment_storage import remove_files, storage_path, user_dir
from app.services.transactions import LISTED_TYPES

MAX_PER_TRANSACTION = 10
CHUNK_SIZE = 64 * 1024
FALLBACK_NAME = "anexo"
MAX_NAME_LENGTH = 255

PDF = "application/pdf"
JPEG = "image/jpeg"
PNG = "image/png"
WEBP = "image/webp"
TEXT = "text/plain"

# Extensoes aceitas para cada tipo detectado. A extensao tem que combinar com o conteudo.
ALLOWED_EXTENSIONS = {
    PDF: {".pdf"},
    JPEG: {".jpg", ".jpeg"},
    PNG: {".png"},
    WEBP: {".webp"},
    TEXT: {".txt", ".csv"},
}


# ---------- Nome e tipo (funcoes puras) ----------


def sanitize_name(raw: str | None) -> str:
    """Nome so para mostrar e baixar: sem caminho, sem caracteres de controle, espacos normalizados,
    ate 255 caracteres. Nome vazio vira "anexo"."""
    name = (raw or "").replace("\\", "/").split("/")[-1]
    name = re.sub(r"\s+", " ", name)
    # Controle (inclui NUL), formatacao invisivel (ex: inversao de direcao) e surrogates soltos
    name = "".join(char for char in name if unicodedata.category(char) not in ("Cc", "Cf", "Cs")).strip()
    if not name.strip("."):
        return FALLBACK_NAME
    if len(name) > MAX_NAME_LENGTH:
        extension = os.path.splitext(name)[1]
        if len(extension) > 20:
            extension = ""
        name = name[: MAX_NAME_LENGTH - len(extension)].rstrip() + extension
    return name


def extension_of(name: str) -> str:
    return os.path.splitext(name)[1].lower()


def detect_binary_type(head: bytes) -> str | None:
    """Tipo pelos primeiros bytes (magic bytes). None quando nao e um dos formatos binarios aceitos."""
    if head.startswith(b"%PDF-"):
        return PDF
    if head.startswith(b"\xff\xd8\xff"):
        return JPEG
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return PNG
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return WEBP
    return None


def _type_not_allowed() -> AppError:
    return AppError(
        415,
        ErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED,
        "Tipo de arquivo nao permitido. Envie PDF, JPEG, PNG, WEBP, TXT ou CSV",
    )


# ---------- Acesso ----------


def get_owned_attachment(db: Session, user_id: uuid.UUID, attachment_id: uuid.UUID) -> Attachment:
    """404 tambem quando o anexo e de outro usuario, para nao revelar que ele existe."""
    attachment = db.execute(
        select(Attachment).where(Attachment.id == attachment_id, Attachment.user_id == user_id)
    ).scalar_one_or_none()
    if not attachment:
        raise AppError(404, ErrorCode.ATTACHMENT_NOT_FOUND, "Anexo nao encontrado")
    return attachment


def get_attachable_transaction(
    db: Session, user_id: uuid.UUID, transaction_id: uuid.UUID, *, lock: bool = False
) -> Transaction:
    """Lancamento do usuario que aparece na lista. Os de sistema (saldo inicial, conciliacao) nao
    aceitam anexo. Com `lock`, trava a linha ate o fim da requisicao."""
    statement = select(Transaction).where(Transaction.id == transaction_id, Transaction.user_id == user_id)
    if lock:
        statement = statement.with_for_update()
    transaction = db.execute(statement).scalar_one_or_none()
    visible = transaction is not None and db.scalar(
        select(func.count())
        .select_from(TransactionSplit)
        .where(TransactionSplit.transaction_id == transaction.id, TransactionSplit.type.in_(LISTED_TYPES))
    )
    if not visible:
        raise AppError(404, ErrorCode.TRANSACTION_NOT_FOUND, "Transacao nao encontrada")
    return transaction


def list_attachments(db: Session, user_id: uuid.UUID, transaction_id: uuid.UUID) -> list[Attachment]:
    get_attachable_transaction(db, user_id, transaction_id)
    return list(
        db.execute(
            select(Attachment)
            .where(Attachment.transaction_id == transaction_id, Attachment.user_id == user_id)
            .order_by(Attachment.created_at.desc(), Attachment.id)
        ).scalars()
    )


# ---------- Envio ----------


def _read_chunk(stream: BinaryIO) -> bytes:
    return stream.read(CHUNK_SIZE)


def create_attachment(
    db: Session, user: User, transaction_id: uuid.UUID, raw_name: str | None, stream: BinaryIO
) -> Attachment:
    """Valida e guarda o arquivo. O commit fica com quem chama. Se o commit falhar, quem chama
    precisa apagar o arquivo (`storage_path` do anexo devolvido)."""
    # Trava o lancamento: dois envios juntos nao passam do limite de anexos
    transaction = get_attachable_transaction(db, user.id, transaction_id, lock=True)
    count = db.scalar(select(func.count()).select_from(Attachment).where(Attachment.transaction_id == transaction.id))
    if count >= MAX_PER_TRANSACTION:
        raise AppError(
            409,
            ErrorCode.ATTACHMENT_LIMIT_REACHED,
            f"Este lancamento ja tem {MAX_PER_TRANSACTION} anexos, o maximo permitido",
        )

    name = sanitize_name(raw_name)
    first = _read_chunk(stream)
    if not first:
        raise AppError(422, ErrorCode.ATTACHMENT_EMPTY, "O arquivo esta vazio")

    content_type = detect_binary_type(first) or TEXT
    if extension_of(name) not in ALLOWED_EXTENSIONS[content_type]:
        # Inclui conteudo de tipo desconhecido (cai em texto) com extensao que nao e de texto
        raise _type_not_allowed()

    storage_name = uuid.uuid4().hex
    directory = user_dir(user.id)
    directory.mkdir(parents=True, exist_ok=True)
    temp_path = directory / f".tmp-{storage_name}"
    digest = hashlib.sha256()
    size = 0
    try:
        with open(temp_path, "wb") as out:
            chunk = first
            while chunk:
                size += len(chunk)
                if size > settings.attachment_max_bytes:
                    limit_mb = settings.attachment_max_bytes // (1024 * 1024)
                    raise AppError(413, ErrorCode.ATTACHMENT_TOO_LARGE, f"O arquivo passa do limite de {limit_mb} MB")
                if content_type == TEXT and b"\x00" in chunk:
                    raise _type_not_allowed()
                digest.update(chunk)
                out.write(chunk)
                chunk = _read_chunk(stream)
        # Rename no mesmo diretorio e atomico: nunca existe arquivo pela metade com o nome final
        os.replace(temp_path, storage_path(user.id, storage_name))
    except BaseException:
        remove_files([temp_path])
        raise

    attachment = Attachment(
        user_id=user.id,
        transaction_id=transaction.id,
        original_name=name,
        content_type=content_type,
        size_bytes=size,
        sha256=digest.hexdigest(),
        storage_name=storage_name,
    )
    try:
        db.add(attachment)
        db.flush()
    except BaseException:
        remove_files([storage_path(user.id, storage_name)])
        raise
    return attachment


def delete_attachment(db: Session, attachment: Attachment) -> list[Path]:
    """Remove o registro e devolve os arquivos a apagar depois do commit."""
    paths = [storage_path(attachment.user_id, attachment.storage_name)]
    db.delete(attachment)
    db.flush()
    return paths
