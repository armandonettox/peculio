"""parcelamento: grupo, indice e total de parcelas no lancamento

Revision ID: 0027
Revises: 0026
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("transactions", sa.Column("installment_group_id", sa.Uuid(), nullable=True))
    op.add_column("transactions", sa.Column("installment_index", sa.Integer(), nullable=True))
    op.add_column("transactions", sa.Column("installment_count", sa.Integer(), nullable=True))
    op.create_index(
        "ix_transactions_installment_group_id", "transactions", ["installment_group_id"]
    )
    op.create_index(
        "uq_transactions_installment_group_id_installment_index",
        "transactions",
        ["installment_group_id", "installment_index"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_transactions_installment_group_id_installment_index", table_name="transactions")
    op.drop_index("ix_transactions_installment_group_id", table_name="transactions")
    op.drop_column("transactions", "installment_count")
    op.drop_column("transactions", "installment_index")
    op.drop_column("transactions", "installment_group_id")
