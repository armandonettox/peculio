"""icone da categoria

Revision ID: 0036
Revises: 0035
Create Date: 2026-11-07

Adiciona icon (nome do icone, texto curto) na tabela categories. Opcional: categoria sem icone usa o padrao da tela.
A lista de nomes aceitos vale na API, nao no banco, para poder crescer sem nova migration.
"""
from alembic import op
import sqlalchemy as sa

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("categories", sa.Column("icon", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("categories", "icon")
