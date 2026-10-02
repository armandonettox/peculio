import enum
import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, Date, DateTime, Enum, ForeignKey, Integer, String, Text, Uuid, func, true
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RecurrenceFrequency(enum.StrEnum):
    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"
    quarterly = "quarterly"
    half_yearly = "half_yearly"
    yearly = "yearly"


class Recurrence(Base):
    """Lancamento que se repete sozinho. Guarda um modelo (`template`, o mesmo corpo de um lancamento) e
    cria um lancamento de verdade a cada data. As datas saem so do primeiro dia e da frequencia."""

    __tablename__ = "recurrences"
    __table_args__ = (
        CheckConstraint("max_occurrences IS NULL OR max_occurrences >= 1", name="max_occurrences_positive"),
        CheckConstraint("end_date IS NULL OR max_occurrences IS NULL", name="one_end_rule"),
        CheckConstraint("next_index >= 0", name="next_index_not_negative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    frequency: Mapped[RecurrenceFrequency] = mapped_column(Enum(RecurrenceFrequency, native_enum=False, length=16))
    first_date: Mapped[date] = mapped_column(Date)
    # Fim: nunca (os dois vazios), numa data ou depois de N lancamentos
    end_date: Mapped[date | None] = mapped_column(Date)
    max_occurrences: Mapped[int | None] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    # Corpo do lancamento (TransactionCreate) sem as datas, que vem de cada ocorrencia
    template: Mapped[dict] = mapped_column(JSON)
    # Quantos lancamentos ja foram criados, e a data do proximo (vazia quando terminou)
    next_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    next_date: Mapped[date | None] = mapped_column(Date, index=True)
    # Por que a ultima tentativa falhou. Limpa quando uma ocorrencia e criada com sucesso.
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
