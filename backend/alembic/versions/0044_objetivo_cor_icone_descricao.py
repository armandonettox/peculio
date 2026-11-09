"""cor, icone e descricao do objetivo (antigo cofrinho)

Revision ID: 0044
Revises: 0043
Create Date: 2026-11-09

Acrescenta color, icon e description em piggy_banks. Todos opcionais: objetivo antigo continua valendo sem eles e a tela
usa o visual padrao. A lista de icones aceitos vale na API, nao no banco, para poder crescer sem nova migration.
"""
from alembic import op
import sqlalchemy as sa

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("piggy_banks", sa.Column("color", sa.String(7), nullable=True))
    op.add_column("piggy_banks", sa.Column("icon", sa.String(32), nullable=True))
    op.add_column("piggy_banks", sa.Column("description", sa.String(300), nullable=True))


def downgrade() -> None:
    op.drop_column("piggy_banks", "description")
    op.drop_column("piggy_banks", "icon")
    op.drop_column("piggy_banks", "color")
