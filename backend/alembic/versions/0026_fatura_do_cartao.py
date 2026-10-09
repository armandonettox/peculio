"""fatura do cartao: dia de fechamento e de vencimento na conta

Revision ID: 0026
Revises: 0025
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("closing_day", sa.Integer(), nullable=True))
    op.add_column("accounts", sa.Column("due_day", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("accounts", "due_day")
    op.drop_column("accounts", "closing_day")
