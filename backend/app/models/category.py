import enum
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CategoryKind(enum.StrEnum):
    # Mesmos nomes do AccountType, que ja representa a mesma ideia (conta de despesa/receita)
    expense = "expense"
    revenue = "revenue"


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (CheckConstraint("color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'", name="color_hex"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    # Categoria de saida (gasto) ou de entrada (recebimento); so vale como categoria desse sentido
    kind: Mapped[CategoryKind] = mapped_column(Enum(CategoryKind, native_enum=False, length=16))
    # Cor da categoria nos graficos e listas, no formato #RRGGBB
    color: Mapped[str | None] = mapped_column(String(7))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Nome unico por usuario sem diferenciar maiuscula de minuscula, garantido pelo banco:
# "Mercado" e "mercado" sao a mesma categoria, mesmo que duas requisicoes cheguem juntas.
Index("uq_categories_user_id_lower_name", Category.user_id, func.lower(Category.name), unique=True)
