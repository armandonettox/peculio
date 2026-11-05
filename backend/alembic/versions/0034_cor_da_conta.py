"""cor da conta (indicador visual nos cards)

Revision ID: 0034
Revises: 0033
Create Date: 2026-11-05

Adiciona color (hex 7 chars, ex: "#6366f1") na tabela accounts. Opcional.
"""
from alembic import op
import sqlalchemy as sa

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("color", sa.String(7), nullable=True))


def downgrade() -> None:
    op.drop_column("accounts", "color")
