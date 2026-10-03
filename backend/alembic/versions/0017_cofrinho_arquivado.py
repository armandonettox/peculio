"""cofrinho arquivado: o valor guardado continua reservado

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("piggy_banks", sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False))


def downgrade() -> None:
    op.drop_column("piggy_banks", "active")
