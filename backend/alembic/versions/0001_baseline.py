"""baseline sem tabelas

Revision ID: 0001
Revises:
Create Date: 2026-09-30
"""
from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Ponto de partida do historico. As tabelas entram nas proximas migrations.
    pass


def downgrade() -> None:
    pass
