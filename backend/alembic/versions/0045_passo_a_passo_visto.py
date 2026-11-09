"""marca se a pessoa ja viu o passo a passo do primeiro uso

Revision ID: 0045
Revises: 0044
Create Date: 2026-11-09

Acrescenta onboarding_done em users. Todo mundo comeca em falso, inclusive quem ja tinha conta: o passo a passo aparece uma
vez para todos e pode ser fechado. Fica no servidor (e nao so no navegador) para valer em qualquer aparelho.
"""
from alembic import op
import sqlalchemy as sa

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("onboarding_done", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("users", "onboarding_done")
