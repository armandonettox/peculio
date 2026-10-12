"""orcamento e envelope viram um so: limite com sobra opcional carregada mes a mes

Revision ID: 0030
Revises: 0029
Create Date: 2026-10-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("budgets", sa.Column("carry_over", sa.Boolean(), server_default=sa.false(), nullable=False))

    # Envelope (sem limite): vira um orcamento com carry_over ligado, usando a ultima distribuicao
    # mensal como o novo limite fixo (0 se nunca distribuiu nada)
    op.execute(
        """
        UPDATE budgets
        SET carry_over = true,
            amount = COALESCE(
                (
                    SELECT amount FROM budget_allocations
                    WHERE budget_allocations.budget_id = budgets.id
                    ORDER BY month DESC
                    LIMIT 1
                ),
                0.01
            )
        WHERE mode = 'envelope'
        """
    )

    op.drop_table("budget_templates")
    op.drop_table("budget_allocations")

    op.drop_constraint(op.f("ck_budgets_mode_matches_amount"), "budgets", type_="check")
    op.drop_constraint(op.f("ck_budgets_amount_positive"), "budgets", type_="check")
    op.alter_column("budgets", "amount", existing_type=sa.Numeric(precision=18, scale=2), nullable=False)
    op.create_check_constraint(op.f("ck_budgets_amount_positive"), "budgets", "amount > 0")
    op.create_check_constraint(op.f("ck_budgets_carry_over_is_monthly"), "budgets", "NOT carry_over OR period = 'monthly'")
    op.drop_column("budgets", "mode")


def downgrade() -> None:
    op.add_column(
        "budgets",
        sa.Column("mode", sa.Enum("fixed", "envelope", name="budgetmode", native_enum=False, length=16), server_default="fixed", nullable=False),
    )
    op.execute("UPDATE budgets SET mode = 'envelope' WHERE carry_over")
    op.drop_constraint(op.f("ck_budgets_carry_over_is_monthly"), "budgets", type_="check")
    op.drop_constraint(op.f("ck_budgets_amount_positive"), "budgets", type_="check")
    op.alter_column("budgets", "amount", existing_type=sa.Numeric(precision=18, scale=2), nullable=True)
    op.create_check_constraint(op.f("ck_budgets_amount_positive"), "budgets", "amount IS NULL OR amount > 0")
    op.create_check_constraint(op.f("ck_budgets_mode_matches_amount"), "budgets", "(mode = 'fixed') = (amount IS NOT NULL)")
    op.execute("UPDATE budgets SET amount = NULL WHERE mode = 'envelope'")
    op.drop_column("budgets", "carry_over")

    op.create_table(
        "budget_allocations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("budget_id", sa.Uuid(), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("amount <> 0", name=op.f("ck_budget_allocations_amount_not_zero")),
        sa.CheckConstraint("extract(day from month) = 1", name=op.f("ck_budget_allocations_month_is_first_day")),
        sa.ForeignKeyConstraint(["budget_id"], ["budgets.id"], name=op.f("fk_budget_allocations_budget_id_budgets"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_budget_allocations_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_allocations")),
        sa.UniqueConstraint("budget_id", "month", name="uq_budget_allocations_budget_id_month"),
    )
    op.create_index("ix_budget_allocations_user_id", "budget_allocations", ["user_id"])

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
        sa.ForeignKeyConstraint(["bill_id"], ["bills.id"], name=op.f("fk_budget_templates_bill_id_bills"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["budget_id"], ["budgets.id"], name=op.f("fk_budget_templates_budget_id_budgets"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_budget_templates_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_templates")),
        sa.UniqueConstraint("budget_id", name="uq_budget_templates_budget_id"),
    )
    op.create_index("ix_budget_templates_user_id", "budget_templates", ["user_id"])
