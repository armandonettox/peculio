import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ApiTokenScope(enum.StrEnum):
    # So consulta (GET). Qualquer outra chamada e recusada.
    read = "read"
    # Consulta e tambem cria, edita e exclui.
    write = "write"


class ApiToken(Base):
    """Token pessoal para scripts e integracoes. O valor nunca e guardado: so o hash (SHA-256) e o prefixo, que
    a pessoa usa para reconhecer o token na lista. Revogar apaga a linha."""

    __tablename__ = "api_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    prefix: Mapped[str] = mapped_column(String(16))
    scope: Mapped[ApiTokenScope] = mapped_column(Enum(ApiTokenScope, native_enum=False, length=16))
    # Vazio = nunca expira
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


Index("uq_api_tokens_user_id_lower_name", ApiToken.user_id, func.lower(ApiToken.name), unique=True)
