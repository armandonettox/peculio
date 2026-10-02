import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Index, Integer, String, Uuid, func, true
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.services.rules_engine import MatchMode


class RuleGroup(Base):
    """Agrupa regras para a pessoa organizar a lista. A ordem de execucao e a do grupo e, dentro
    dele, a da regra; regras sem grupo rodam depois de todos os grupos."""

    __tablename__ = "rule_groups"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


Index("uq_rule_groups_user_id_lower_name", RuleGroup.user_id, func.lower(RuleGroup.name), unique=True)


class Rule(Base):
    """Gatilhos e acoes ficam em JSON validado pelo schema: a regra e lida e gravada inteira, nunca
    consultada por dentro."""

    __tablename__ = "rules"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Excluir o grupo solta as regras (ficam sem grupo), nao as apaga
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("rule_groups.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(100))
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    match_mode: Mapped[MatchMode] = mapped_column(Enum(MatchMode, native_enum=False, length=8))
    stop_processing: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    triggers: Mapped[list] = mapped_column(JSON)
    actions: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


Index("uq_rules_user_id_lower_name", Rule.user_id, func.lower(Rule.name), unique=True)
Index("ix_rules_group_id", Rule.group_id)
