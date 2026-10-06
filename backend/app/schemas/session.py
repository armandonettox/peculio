import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SessionOut(BaseModel):
    """Um aparelho conectado. Nunca traz a chave de renovacao nem o endereco IP."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_label: str
    remember: bool
    created_at: datetime
    last_used_at: datetime
    expires_at: datetime
    # A sessao desta aba
    current: bool = False


class SessionsRevoked(BaseModel):
    revoked: int
