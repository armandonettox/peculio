from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Currency(Base):
    """Moedas disponiveis. Tabela global (igual para todos os usuarios), carregada pela migration."""

    __tablename__ = "currencies"

    # Codigo ISO 4217, ex: BRL
    code: Mapped[str] = mapped_column(String(3), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    symbol: Mapped[str] = mapped_column(String(8))
    # JPY tem 0 casas, BRL tem 2. Valores com mais casas que isso sao recusados.
    decimal_places: Mapped[int] = mapped_column(Integer, default=2, server_default="2")
