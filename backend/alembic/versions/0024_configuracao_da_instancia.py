"""configuracao da instancia: chave e valor (contato de seguranca)

Revision ID: 0024
Revises: 0023
Create Date: 2026-10-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "instance_settings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_instance_settings")),
    )


def downgrade() -> None:
    op.drop_table("instance_settings")
