"""cofrinhos

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "piggy_banks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("target_amount", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("target_amount > 0", name=op.f("ck_piggy_banks_target_amount_positive")),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], name=op.f("fk_piggy_banks_account_id_accounts"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_piggy_banks_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_piggy_banks")),
    )
    op.create_index(op.f("ix_piggy_banks_account_id"), "piggy_banks", ["account_id"])
    op.create_index("uq_piggy_banks_user_id_lower_name", "piggy_banks", ["user_id", sa.literal_column("lower(name)")], unique=True)
    op.create_table(
        "piggy_bank_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("piggy_bank_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("amount <> 0", name=op.f("ck_piggy_bank_events_amount_not_zero")),
        sa.ForeignKeyConstraint(["piggy_bank_id"], ["piggy_banks.id"], name=op.f("fk_piggy_bank_events_piggy_bank_id_piggy_banks"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_piggy_bank_events_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_piggy_bank_events")),
    )
    op.create_index(op.f("ix_piggy_bank_events_piggy_bank_id"), "piggy_bank_events", ["piggy_bank_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_piggy_bank_events_piggy_bank_id"), table_name="piggy_bank_events")
    op.drop_table("piggy_bank_events")
    op.drop_index("uq_piggy_banks_user_id_lower_name", table_name="piggy_banks")
    op.drop_index(op.f("ix_piggy_banks_account_id"), table_name="piggy_banks")
    op.drop_table("piggy_banks")
