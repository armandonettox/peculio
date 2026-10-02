import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    func,
    true,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class WebhookEvent(enum.StrEnum):
    transaction_created = "transaction.created"
    transaction_updated = "transaction.updated"
    transaction_deleted = "transaction.deleted"


# Evento que so existe no botao "Testar": nenhum webhook se inscreve nele
TEST_EVENT = "webhook.test"


class DeliveryStatus(enum.StrEnum):
    pending = "pending"
    delivered = "delivered"
    failed = "failed"


class Webhook(Base):
    """Endereco que o app avisa (POST assinado) quando algo acontece com os lancamentos do usuario."""

    __tablename__ = "webhooks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    url: Mapped[str] = mapped_column(String(2048))
    # Segredo da assinatura, cifrado com a ENCRYPTION_KEY. O texto puro so sai na criacao e na rotacao.
    secret_encrypted: Mapped[str] = mapped_column(Text)
    events: Mapped[list[str]] = mapped_column(ARRAY(String(50)))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


Index("uq_webhooks_user_id_lower_name", Webhook.user_id, func.lower(Webhook.name), unique=True)


class WebhookDelivery(Base):
    """Uma entrega de um evento a um webhook. Serve de fila (outbox) e de historico: nasce pendente
    na mesma transacao da operacao que gerou o evento, e o laco de fundo a entrega depois."""

    __tablename__ = "webhook_deliveries"
    __table_args__ = (
        CheckConstraint("attempts >= 0", name="attempts_not_negative"),
        Index("ix_webhook_deliveries_status_next_attempt_at", "status", "next_attempt_at"),
        Index("ix_webhook_deliveries_webhook_id_created_at", "webhook_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    webhook_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("webhooks.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    event: Mapped[str] = mapped_column(String(50))
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[DeliveryStatus] = mapped_column(
        Enum(DeliveryStatus, native_enum=False, length=16), default=DeliveryStatus.pending
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_status_code: Mapped[int | None] = mapped_column(Integer)
    last_error: Mapped[str | None] = mapped_column(Text)
    response_excerpt: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
