"""recorrentes

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recurrences",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column(
            "frequency",
            sa.Enum("daily", "weekly", "monthly", "quarterly", "half_yearly", "yearly", name="recurrencefrequency", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("first_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("max_occurrences", sa.Integer(), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("template", sa.JSON(), nullable=False),
        sa.Column("next_index", sa.Integer(), server_default="0", nullable=False),
        sa.Column("next_date", sa.Date(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("max_occurrences IS NULL OR max_occurrences >= 1", name=op.f("ck_recurrences_max_occurrences_positive")),
        sa.CheckConstraint("end_date IS NULL OR max_occurrences IS NULL", name=op.f("ck_recurrences_one_end_rule")),
        sa.CheckConstraint("next_index >= 0", name=op.f("ck_recurrences_next_index_not_negative")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_recurrences_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recurrences")),
    )
    op.create_index(op.f("ix_recurrences_user_id"), "recurrences", ["user_id"])
    op.create_index(op.f("ix_recurrences_next_date"), "recurrences", ["next_date"])

    op.add_column("transactions", sa.Column("recurrence_id", sa.Uuid(), nullable=True))
    op.add_column("transactions", sa.Column("recurrence_date", sa.Date(), nullable=True))
    op.create_foreign_key(
        op.f("fk_transactions_recurrence_id_recurrences"),
        "transactions", "recurrences", ["recurrence_id"], ["id"], ondelete="SET NULL",
    )
    # A garantia contra duplicar: uma recorrente so cria uma vez cada data, mesmo com dois processos
    op.create_index(
        "uq_transactions_recurrence_id_recurrence_date",
        "transactions",
        ["recurrence_id", "recurrence_date"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_transactions_recurrence_id_recurrence_date", table_name="transactions")
    op.drop_constraint(op.f("fk_transactions_recurrence_id_recurrences"), "transactions", type_="foreignkey")
    op.drop_column("transactions", "recurrence_date")
    op.drop_column("transactions", "recurrence_id")
    op.drop_index(op.f("ix_recurrences_next_date"), table_name="recurrences")
    op.drop_index(op.f("ix_recurrences_user_id"), table_name="recurrences")
    op.drop_table("recurrences")
