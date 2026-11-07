import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Favorite(Base):
    """Descricao favorita: guarda com ela a categoria e a conta, nunca o valor. Aparece primeiro nas sugestoes ao
    digitar a descricao de um lancamento novo."""

    __tablename__ = "favorites"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Saida (withdrawal) ou entrada (deposit): a mesma descricao pode ser favorita nos dois sentidos
    type: Mapped[str] = mapped_column(String(16))
    description: Mapped[str] = mapped_column(String(255))
    # Excluir a categoria ou a conta solta o favorito, nao o apaga
    category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    account_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Uma descricao favorita por sentido, sem diferenciar maiuscula de minuscula, garantido pelo banco
Index("uq_favorites_user_id_type_lower_description", Favorite.user_id, Favorite.type, func.lower(Favorite.description), unique=True)
