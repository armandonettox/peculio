"""alerta de orcamento: ate onde o aviso ja foi dado no periodo

Revision ID: 0041
Revises: 0040
Create Date: 2026-11-08

Duas colunas no orcamento para o evento budget.alert avisar uma vez por cruzamento (80% e 100%) em cada periodo, e nao a
cada lancamento. Os orcamentos que ja existem comecam em "none".
"""
from alembic import op
import sqlalchemy as sa

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "budgets",
        sa.Column(
            "alert_level",
            sa.Enum("none", "warning", "over", name="budgetalertlevel", native_enum=False, length=8),
            server_default="none",
            nullable=False,
        ),
    )
    op.add_column("budgets", sa.Column("alert_period_start", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("budgets", "alert_period_start")
    op.drop_column("budgets", "alert_level")
