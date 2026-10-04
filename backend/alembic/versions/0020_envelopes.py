"""envelopes: modo do orcamento, valor distribuido por mes e conta que entra nos envelopes

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("in_envelopes", sa.Boolean(), server_default=sa.true(), nullable=False))

    op.add_column(
        "budgets",
        sa.Column("mode", sa.Enum("fixed", "envelope", name="budgetmode", native_enum=False, length=16), server_default="fixed", nullable=False),
    )
    op.drop_constraint(op.f("ck_budgets_amount_positive"), "budgets", type_="check")
    op.alter_column("budgets", "amount", existing_type=sa.Numeric(precision=18, scale=2), nullable=True)
    op.create_check_constraint(op.f("ck_budgets_amount_positive"), "budgets", "amount IS NULL OR amount > 0")
    op.create_check_constraint(op.f("ck_budgets_mode_matches_amount"), "budgets", "(mode = 'fixed') = (amount IS NOT NULL)")

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


def downgrade() -> None:
    op.drop_index("ix_budget_allocations_user_id", table_name="budget_allocations")
    op.drop_table("budget_allocations")
    # Envelope nao existe antes desta versao: sai junto, senao o limite obrigatorio nao teria valor
    op.execute("DELETE FROM budgets WHERE mode = 'envelope'")
    op.drop_constraint(op.f("ck_budgets_mode_matches_amount"), "budgets", type_="check")
    op.drop_constraint(op.f("ck_budgets_amount_positive"), "budgets", type_="check")
    op.alter_column("budgets", "amount", existing_type=sa.Numeric(precision=18, scale=2), nullable=False)
    op.create_check_constraint(op.f("ck_budgets_amount_positive"), "budgets", "amount > 0")
    op.drop_column("budgets", "mode")
    op.drop_column("accounts", "in_envelopes")
