import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Uuid,
    func,
    text,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.transaction import TransactionType


class RecurrenceFrequency(enum.StrEnum):
    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"
    quarterly = "quarterly"
    half_yearly = "half_yearly"
    yearly = "yearly"


class Recurrence(Base):
    """Algo que se repete: ou cria o lancamento sozinho (`auto_create`, com um `template`), ou so
    lembra que vai vencer e espera a pessoa lancar (sem `auto_create`, com uma faixa de valor e um
    texto para ligar sozinho a um lancamento que ja existe). As datas saem so da primeira e da
    frequencia, nos dois modos."""

    __tablename__ = "recurrences"
    __table_args__ = (
        CheckConstraint("max_occurrences IS NULL OR max_occurrences >= 1", name="max_occurrences_positive"),
        CheckConstraint("end_date IS NULL OR max_occurrences IS NULL", name="one_end_rule"),
        CheckConstraint("next_index >= 0", name="next_index_not_negative"),
        CheckConstraint("amount_min IS NULL OR amount_min > 0", name="amount_min_positive"),
        CheckConstraint("amount_max IS NULL OR amount_min IS NULL OR amount_max >= amount_min", name="amount_max_at_least_min"),
        CheckConstraint(
            "(auto_create AND template IS NOT NULL) "
            "OR (NOT auto_create AND amount_min IS NOT NULL AND amount_max IS NOT NULL AND currency_code IS NOT NULL)",
            name="mode_matches_fields",
        ),
        CheckConstraint("type IS NULL OR type IN ('withdrawal', 'deposit')", name="type_is_withdrawal_or_deposit"),
        CheckConstraint("(auto_create AND type IS NULL) OR (NOT auto_create AND type IS NOT NULL)", name="type_matches_mode"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    frequency: Mapped[RecurrenceFrequency] = mapped_column(Enum(RecurrenceFrequency, native_enum=False, length=16))
    first_date: Mapped[date] = mapped_column(Date)
    # Fim: nunca (os dois vazios), numa data ou depois de N ocorrencias
    end_date: Mapped[date | None] = mapped_column(Date)
    max_occurrences: Mapped[int | None] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    # Liga: cria o lancamento sozinho a cada ocorrencia (precisa de template). Desliga: so lembra o
    # vencimento, a pessoa lanca e o app liga sozinho pelo valor/texto (precisa de faixa e moeda).
    auto_create: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Corpo do lancamento (TransactionCreate) sem as datas, que vem de cada ocorrencia. So no modo automatico.
    template: Mapped[dict | None] = mapped_column(JSON)
    # Quantos lancamentos ja foram criados, e a data do proximo (vazia quando terminou). So no modo automatico.
    next_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    next_date: Mapped[date | None] = mapped_column(Date, index=True)
    # Por que a ultima tentativa falhou. Limpa quando uma ocorrencia e criada com sucesso. So no modo automatico.
    last_error: Mapped[str | None] = mapped_column(Text)
    # A moeda nao muda depois de criada: so lancamentos nela podem ser ligados. So no modo de lembrete.
    currency_code: Mapped[str | None] = mapped_column(ForeignKey("currencies.code"))
    amount_min: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    amount_max: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    # Trecho procurado na descricao ou no nome de quem recebeu, para ligar sozinho. Vazio: so liga a mao.
    match_text: Mapped[str | None] = mapped_column(String(100))
    # Saida (despesa) ou entrada (receita) que o lembrete espera. So no modo de lembrete; no
    # automatico o sentido ja esta no template.
    type: Mapped[TransactionType | None] = mapped_column(Enum(TransactionType, native_enum=False, length=32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# So vale para o modo de lembrete: no modo automatico o nome nao precisa ser unico
Index(
    "uq_recurrences_user_id_lower_name",
    Recurrence.user_id,
    func.lower(Recurrence.name),
    unique=True,
    postgresql_where=text("NOT auto_create"),
)
