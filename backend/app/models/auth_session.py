import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AuthSession(Base):
    """Um login de uma pessoa num aparelho. A chave de renovacao (cookie HttpOnly) nunca fica aqui em texto:
    so o hash. `previous_hash` guarda a chave anterior por alguns segundos, para duas abas abertas juntas nao
    se derrubarem; uma chave velha que volta depois disso indica roubo e encerra a sessao."""

    __tablename__ = "auth_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    refresh_hash: Mapped[str] = mapped_column(String(64), unique=True)
    previous_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # "Manter conectado" marcado: cookie de 30 dias. Desmarcado: cookie de sessao do navegador
    remember: Mapped[bool] = mapped_column(Boolean, default=False)
    # So o navegador e o sistema ("Chrome no Windows"), sem endereco IP
    device_label: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_auth_sessions_user_id", "user_id"),
        Index("ix_auth_sessions_previous_hash", "previous_hash"),
    )
