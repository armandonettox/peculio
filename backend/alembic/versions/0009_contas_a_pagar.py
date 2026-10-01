"""contas a pagar

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bills",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("currency_code", sa.String(), nullable=False),
        sa.Column("amount_min", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("amount_max", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("match_text", sa.String(length=100), nullable=True),
        sa.Column("first_due_date", sa.Date(), nullable=False),
        sa.Column(
            "frequency",
            sa.Enum("weekly", "monthly", "quarterly", "half_yearly", "yearly", name="billfrequency", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("amount_min > 0", name=op.f("ck_bills_amount_min_positive")),
        sa.CheckConstraint("amount_max >= amount_min", name=op.f("ck_bills_amount_max_at_least_min")),
        sa.ForeignKeyConstraint(["currency_code"], ["currencies.code"], name=op.f("fk_bills_currency_code_currencies")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_bills_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bills")),
    )
    op.create_index("uq_bills_user_id_lower_name", "bills", ["user_id", sa.literal_column("lower(name)")], unique=True)
    op.add_column("transaction_splits", sa.Column("bill_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_transaction_splits_bill_id_bills"),
        "transaction_splits", "bills", ["bill_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_transaction_splits_bill_id_bills"), "transaction_splits", type_="foreignkey")
    op.drop_column("transaction_splits", "bill_id")
    op.drop_index("uq_bills_user_id_lower_name", table_name="bills")
    op.drop_table("bills")
