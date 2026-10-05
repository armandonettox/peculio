from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class InstanceSetting(Base):
    """Configuracao da instalacao inteira (nao de uma pessoa), guardada como chave e valor.
    Hoje so o contato de seguranca; chaves novas entram sem migration."""

    __tablename__ = "instance_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
