import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    transaction_id: uuid.UUID
    original_name: str
    # Tipo detectado pelo conteudo
    content_type: str
    size_bytes: int
    created_at: datetime
