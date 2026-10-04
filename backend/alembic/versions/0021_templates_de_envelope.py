"""templates de envelope: regra de quanto distribuir por mes

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "budget_templates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("budget_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.Enum("fixed", "by_date", "bill", "remainder", name="templatekind", native_enum=False, length=16), nullable=False),
        sa.Column("amount", sa.Numeric(precision=18, scale=2), nullable=True),
        sa.Column("target_month", sa.Date(), nullable=True),
        sa.Column("bill_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("amount IS NULL OR amount > 0", name=op.f("ck_budget_templates_amount_positive")),
        sa.CheckConstraint("(kind IN ('fixed', 'by_date')) = (amount IS NOT NULL)", name=op.f("ck_budget_templates_amount_matches_kind")),
        sa.CheckConstraint("(kind = 'by_date') = (target_month IS NOT NULL)", name=op.f("ck_budget_templates_target_month_matches_kind")),
        sa.CheckConstraint("(kind = 'bill') = (bill_id IS NOT NULL)", name=op.f("ck_budget_templates_bill_matches_kind")),
        sa.CheckConstraint("target_month IS NULL OR extract(day from target_month) = 1", name=op.f("ck_budget_templates_target_month_is_first_day")),
        sa.ForeignKeyConstraint(["budget_id"], ["budgets.id"], name=op.f("fk_budget_templates_budget_id_budgets"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_budget_templates_user_id_users"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["bill_id"], ["bills.id"], name=op.f("fk_budget_templates_bill_id_bills"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_templates")),
        sa.UniqueConstraint("budget_id", name="uq_budget_templates_budget_id"),
    )
    op.create_index("ix_budget_templates_user_id", "budget_templates", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_budget_templates_user_id", table_name="budget_templates")
    op.drop_table("budget_templates")
