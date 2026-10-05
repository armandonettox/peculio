import logging
import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import AppError, ErrorCode
from app.models.user import User
from app.schemas.attachment import AttachmentOut
from app.services import attachments as service
from app.services.attachment_storage import remove_files, storage_path

logger = logging.getLogger("peculio")

router = APIRouter(tags=["attachments"])

# Texto sempre sai como texto puro em UTF-8; nada e servido como pagina
TEXT_MEDIA_TYPE = "text/plain; charset=utf-8"


def _content_disposition(name: str) -> str:
    # filename com so ASCII para clientes antigos e filename* com o nome completo
    ascii_name = "".join(c if c.isascii() and c.isprintable() and c not in '"\\;' else "_" for c in name)
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name, safe='')}"


@router.post(
    "/transactions/{transaction_id}/attachments",
    response_model=AttachmentOut,
    status_code=status.HTTP_201_CREATED,
)
def upload_attachment(
    transaction_id: uuid.UUID,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    attachment = service.create_attachment(db, user, transaction_id, file.filename, file.file)
    try:
        db.commit()
    except BaseException:
        remove_files([storage_path(user.id, attachment.storage_name)])
        raise
    db.refresh(attachment)
    return attachment


@router.get("/transactions/{transaction_id}/attachments", response_model=list[AttachmentOut])
def list_attachments(
    transaction_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return service.list_attachments(db, user.id, transaction_id)


@router.get("/attachments/{attachment_id}/download")
def download_attachment(
    attachment_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    attachment = service.get_owned_attachment(db, user.id, attachment_id)
    path = storage_path(attachment.user_id, attachment.storage_name)
    if not path.is_file():
        logger.error("Arquivo do anexo %s nao esta no disco", attachment.id)
        raise AppError(404, ErrorCode.ATTACHMENT_NOT_FOUND, "Anexo nao encontrado")
    media_type = TEXT_MEDIA_TYPE if attachment.content_type == service.TEXT else attachment.content_type
    return FileResponse(
        path,
        media_type=media_type,
        headers={
            "Content-Disposition": _content_disposition(attachment.original_name),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.delete("/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(
    attachment_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    attachment = service.get_owned_attachment(db, user.id, attachment_id)
    paths = service.delete_attachment(db, attachment)
    db.commit()
    remove_files(paths)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
