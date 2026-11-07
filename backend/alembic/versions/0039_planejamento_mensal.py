"""planejamento mensal: renda, economia e limite por categoria

Revision ID: 0039
Revises: 0038
Create Date: 2026-11-08

Duas tabelas novas: monthly_plans (um por mes e usuario) e monthly_plan_items (o limite de cada categoria). Nao mexe em
nenhum dado que ja existe.
"""
from alembic import op
import sqlalchemy as sa

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "monthly_plans",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("currency_code", sa.String(), nullable=False),
        sa.Column("income", sa.Numeric(18, 2), nullable=False),
        sa.Column("savings_percent", sa.Numeric(5, 2), server_default="20", nullable=False),
        sa.Column("card_counting", sa.Enum("purchase", "invoice", name="cardcounting", native_enum=False, length=16), server_default="purchase", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("income >= 0", name=op.f("ck_monthly_plans_income_not_negative")),
        sa.CheckConstraint("savings_percent >= 0 AND savings_percent <= 100", name=op.f("ck_monthly_plans_savings_percent_range")),
        sa.CheckConstraint("EXTRACT(day FROM month) = 1", name=op.f("ck_monthly_plans_month_is_first_day")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_monthly_plans")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_monthly_plans_user_id_users"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["currency_code"], ["currencies.code"], name=op.f("fk_monthly_plans_currency_code_currencies")),
        sa.UniqueConstraint("user_id", "month", name="uq_monthly_plans_user_id_month"),
    )
    op.create_table(
        "monthly_plan_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("plan_id", sa.Uuid(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("alert", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint("amount > 0", name=op.f("ck_monthly_plan_items_amount_positive")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_monthly_plan_items")),
        sa.ForeignKeyConstraint(["plan_id"], ["monthly_plans.id"], name=op.f("fk_monthly_plan_items_plan_id_monthly_plans"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], name=op.f("fk_monthly_plan_items_category_id_categories"), ondelete="CASCADE"),
        sa.UniqueConstraint("plan_id", "category_id", name="uq_monthly_plan_items_plan_id_category_id"),
    )
    op.create_index(op.f("ix_monthly_plan_items_plan_id"), "monthly_plan_items", ["plan_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_monthly_plan_items_plan_id"), table_name="monthly_plan_items")
    op.drop_table("monthly_plan_items")
    op.drop_table("monthly_plans")
