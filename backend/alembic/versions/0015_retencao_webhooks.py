"""retencao das entregas de webhook

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("webhook_deliveries", sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True))
    # Quem ja estava finalizado recebe uma data aproximada (a melhor que existe), senao nunca seria apagado.
    # Pendente continua sem data.
    op.execute(
        sa.text(
            "UPDATE webhook_deliveries "
            "SET finished_at = COALESCE(delivered_at, last_attempt_at, created_at) "
            "WHERE status IN ('delivered', 'failed')"
        )
    )
    op.create_index("ix_webhook_deliveries_status_finished_at", "webhook_deliveries", ["status", "finished_at"])


def downgrade() -> None:
    op.drop_index("ix_webhook_deliveries_status_finished_at", table_name="webhook_deliveries")
    op.drop_column("webhook_deliveries", "finished_at")
