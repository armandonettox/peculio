"""orcamento personalizado: periodo por datas, categorias e alerta

Revision ID: 0040
Revises: 0039
Create Date: 2026-11-08

O orcamento ganha o periodo "custom" (data inicial e final, sem repetir), o alerta e uma tabela com as categorias que
contam para ele. Os orcamentos que ja existem ficam como estao: semanal, mensal ou anual, sem categorias e sem alerta.
"""
from alembic import op
import sqlalchemy as sa

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("budgets", sa.Column("start_date", sa.Date(), nullable=True))
    op.add_column("budgets", sa.Column("end_date", sa.Date(), nullable=True))
    op.add_column("budgets", sa.Column("alert", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    op.create_check_constraint(
        op.f("ck_budgets_custom_period_has_dates"),
        "budgets",
        "(period = 'custom') = (start_date IS NOT NULL AND end_date IS NOT NULL)",
    )
    op.create_check_constraint(op.f("ck_budgets_dates_come_together"), "budgets", "(start_date IS NULL) = (end_date IS NULL)")
    op.create_check_constraint(op.f("ck_budgets_dates_in_order"), "budgets", "start_date IS NULL OR start_date <= end_date")
    op.create_table(
        "budget_categories",
        sa.Column("budget_id", sa.Uuid(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("budget_id", "category_id", name=op.f("pk_budget_categories")),
        sa.ForeignKeyConstraint(["budget_id"], ["budgets.id"], name=op.f("fk_budget_categories_budget_id_budgets"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], name=op.f("fk_budget_categories_category_id_categories"), ondelete="CASCADE"),
    )
    op.create_index(op.f("ix_budget_categories_category_id"), "budget_categories", ["category_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_budget_categories_category_id"), table_name="budget_categories")
    op.drop_table("budget_categories")
    op.drop_constraint(op.f("ck_budgets_dates_in_order"), "budgets", type_="check")
    op.drop_constraint(op.f("ck_budgets_dates_come_together"), "budgets", type_="check")
    op.drop_constraint(op.f("ck_budgets_custom_period_has_dates"), "budgets", type_="check")
    op.drop_column("budgets", "alert")
    op.drop_column("budgets", "end_date")
    op.drop_column("budgets", "start_date")
