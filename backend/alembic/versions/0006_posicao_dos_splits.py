"""posicao dos splits

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Linhas que ja existiam ficam com 0 e continuam em ordem estavel pelo id
    op.add_column("transaction_splits", sa.Column("position", sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    op.drop_column("transaction_splits", "position")
