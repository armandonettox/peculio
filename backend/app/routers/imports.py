import uuid

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.errors import AppError, ErrorCode
from app.models.user import User
from app.schemas.imports import ImportConfirm, ImportMapping, ImportPreviewOut, ImportResultOut
from app.services import imports as service

router = APIRouter(prefix="/imports", tags=["imports"])


def _read_limited(file: UploadFile) -> bytes:
    """Le o arquivo ate o limite mais um byte: passou disso, recusa sem ler o resto."""
    content = file.file.read(settings.import_max_bytes + 1)
    if len(content) > settings.import_max_bytes:
        limit_mb = settings.import_max_bytes // (1024 * 1024)
        raise AppError(413, ErrorCode.IMPORT_FILE_TOO_LARGE, f"O arquivo passa do limite de {limit_mb} MB")
    return content


def _parse_mapping(raw: str | None) -> ImportMapping | None:
    if raw is None or not raw.strip():
        return None
    try:
        return ImportMapping.model_validate_json(raw)
    except ValidationError as error:
        raise AppError(422, ErrorCode.VALIDATION_ERROR, "As colunas escolhidas sao invalidas") from error


@router.post("/preview", response_model=ImportPreviewOut)
def preview_import(
    account_id: uuid.UUID = Form(...),
    mapping: str | None = Form(default=None),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Le o extrato (CSV ou OFX) e mostra o que entraria na conta, sem gravar nada. No CSV, `mapping` e um JSON
    com as colunas; sem ele o servidor tenta adivinhar pelo cabecalho."""
    return service.preview(db, user, account_id, _read_limited(file), _parse_mapping(mapping))


@router.post("/confirm", response_model=ImportResultOut, status_code=status.HTTP_201_CREATED)
def confirm_import(data: ImportConfirm, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Cria os lancamentos das linhas enviadas. Tudo ou nada: se uma linha for recusada, nenhuma entra."""
    result = service.confirm(db, user, data)
    db.commit()
    return result
