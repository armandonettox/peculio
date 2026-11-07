"""lancamento pago/nao pago e ignorado

Revision ID: 0035
Revises: 0034
Create Date: 2026-11-07

Duas colunas em transaction_splits. is_paid (padrao verdadeiro): so o que foi efetivado mexe no
saldo da conta. ignored (padrao falso): o lancamento continua no saldo, mas sai dos totais,
relatorios e orcamentos. O server_default preenche os lancamentos que ja existem sem UPDATE.
"""
from alembic import op
import sqlalchemy as sa

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "transaction_splits",
        sa.Column("is_paid", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.add_column(
        "transaction_splits",
        sa.Column("ignored", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("transaction_splits", "ignored")
    op.drop_column("transaction_splits", "is_paid")
