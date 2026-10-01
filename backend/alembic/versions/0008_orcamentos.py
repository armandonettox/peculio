"""orcamentos

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "budgets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("currency_code", sa.String(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("period", sa.Enum("weekly", "monthly", "yearly", name="budgetperiod", native_enum=False, length=16), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("amount > 0", name=op.f("ck_budgets_amount_positive")),
        sa.ForeignKeyConstraint(["currency_code"], ["currencies.code"], name=op.f("fk_budgets_currency_code_currencies")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_budgets_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budgets")),
    )
    op.create_index("uq_budgets_user_id_lower_name", "budgets", ["user_id", sa.literal_column("lower(name)")], unique=True)
    op.add_column("transaction_splits", sa.Column("budget_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_transaction_splits_budget_id_budgets"),
        "transaction_splits", "budgets", ["budget_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_transaction_splits_budget_id_budgets"), "transaction_splits", type_="foreignkey")
    op.drop_column("transaction_splits", "budget_id")
    op.drop_index("uq_budgets_user_id_lower_name", table_name="budgets")
    op.drop_table("budgets")
