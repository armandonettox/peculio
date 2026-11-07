"""alerta do planejamento mensal: ate onde o aviso ja foi dado em cada limite

Revision ID: 0042
Revises: 0041
Create Date: 2026-11-08

Uma coluna no limite de cada categoria do planejamento mensal, para o evento budget.alert avisar uma vez por cruzamento.
Os limites que ja existem comecam em "none".
"""
from alembic import op
import sqlalchemy as sa

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_plan_items",
        sa.Column(
            "alert_level",
            sa.Enum("none", "warning", "over", name="budgetalertlevel", native_enum=False, length=8),
            server_default="none",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("monthly_plan_items", "alert_level")
