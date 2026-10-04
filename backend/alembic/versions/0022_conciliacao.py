"""conciliacao: lancamentos conferidos e travados, e o historico de conciliacoes fechadas

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reconciliations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("statement_date", sa.Date(), nullable=False),
        sa.Column("statement_balance", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("invalidated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], name=op.f("fk_reconciliations_account_id_accounts"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_reconciliations_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reconciliations")),
    )
    op.create_index("ix_reconciliations_user_id", "reconciliations", ["user_id"])
    op.create_index("ix_reconciliations_account_id", "reconciliations", ["account_id"])

    op.create_table(
        "account_clearings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("split_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("reconciliation_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], name=op.f("fk_account_clearings_account_id_accounts"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reconciliation_id"], ["reconciliations.id"], name=op.f("fk_account_clearings_reconciliation_id_reconciliations"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["split_id"], ["transaction_splits.id"], name=op.f("fk_account_clearings_split_id_transaction_splits"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_account_clearings_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_account_clearings")),
        sa.UniqueConstraint("split_id", "account_id", name="uq_account_clearings_split_id_account_id"),
    )
    op.create_index("ix_account_clearings_user_id", "account_clearings", ["user_id"])
    op.create_index("ix_account_clearings_account_id", "account_clearings", ["account_id"])


def downgrade() -> None:
    op.drop_index("ix_account_clearings_account_id", table_name="account_clearings")
    op.drop_index("ix_account_clearings_user_id", table_name="account_clearings")
    op.drop_table("account_clearings")
    op.drop_index("ix_reconciliations_account_id", table_name="reconciliations")
    op.drop_index("ix_reconciliations_user_id", table_name="reconciliations")
    op.drop_table("reconciliations")
