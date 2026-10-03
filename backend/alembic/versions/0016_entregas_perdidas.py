"""contador de reivindicacoes sem resultado nas entregas de webhook

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("webhook_deliveries", sa.Column("claims", sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    op.drop_column("webhook_deliveries", "claims")
