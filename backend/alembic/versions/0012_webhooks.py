"""webhooks

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "webhooks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=False),
        sa.Column("secret_encrypted", sa.Text(), nullable=False),
        sa.Column("events", postgresql.ARRAY(sa.String(length=50)), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_webhooks_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_webhooks")),
    )
    op.create_index(op.f("ix_webhooks_user_id"), "webhooks", ["user_id"])
    op.create_index("uq_webhooks_user_id_lower_name", "webhooks", ["user_id", sa.literal_column("lower(name)")], unique=True)
    op.create_table(
        "webhook_deliveries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("webhook_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("event", sa.String(length=50), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.Enum("pending", "delivered", "failed", name="deliverystatus", native_enum=False, length=16), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status_code", sa.Integer(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("response_excerpt", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("attempts >= 0", name=op.f("ck_webhook_deliveries_attempts_not_negative")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_webhook_deliveries_user_id_users"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["webhook_id"], ["webhooks.id"], name=op.f("fk_webhook_deliveries_webhook_id_webhooks"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_webhook_deliveries")),
    )
    op.create_index("ix_webhook_deliveries_status_next_attempt_at", "webhook_deliveries", ["status", "next_attempt_at"])
    op.create_index("ix_webhook_deliveries_webhook_id_created_at", "webhook_deliveries", ["webhook_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_webhook_deliveries_webhook_id_created_at", table_name="webhook_deliveries")
    op.drop_index("ix_webhook_deliveries_status_next_attempt_at", table_name="webhook_deliveries")
    op.drop_table("webhook_deliveries")
    op.drop_index("uq_webhooks_user_id_lower_name", table_name="webhooks")
    op.drop_index(op.f("ix_webhooks_user_id"), table_name="webhooks")
    op.drop_table("webhooks")
