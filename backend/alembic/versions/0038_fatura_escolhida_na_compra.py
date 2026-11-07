"""fatura escolhida na compra do cartao

Revision ID: 0038
Revises: 0037
Create Date: 2026-11-07

Adiciona invoice_date (data dentro da fatura escolhida, nula por padrao) em transaction_splits. Nula, a compra entra na
fatura da propria data, como sempre foi: nenhuma fatura existente muda. Nao mexe em dado nenhum.
"""
from alembic import op
import sqlalchemy as sa

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("transaction_splits", sa.Column("invoice_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("transaction_splits", "invoice_date")
