"""identificador externo nos lancamentos, para nao importar o mesmo extrato duas vezes

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("transaction_splits", sa.Column("external_id", sa.String(length=255), nullable=True))
    op.add_column("transaction_splits", sa.Column("external_account_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_transaction_splits_external_account_id_accounts",
        "transaction_splits",
        "accounts",
        ["external_account_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "uq_transaction_splits_external_id",
        "transaction_splits",
        ["user_id", "external_account_id", "external_id"],
        unique=True,
        postgresql_where=sa.text("external_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_transaction_splits_external_id", table_name="transaction_splits")
    op.drop_constraint("fk_transaction_splits_external_account_id_accounts", "transaction_splits", type_="foreignkey")
    op.drop_column("transaction_splits", "external_account_id")
    op.drop_column("transaction_splits", "external_id")
