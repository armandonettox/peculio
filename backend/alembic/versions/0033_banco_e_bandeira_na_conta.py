"""banco e bandeira na conta (para logos no frontend)

Revision ID: 0033
Revises: 0032
Create Date: 2026-11-04

Adiciona banco (texto livre, ex: "Nubank") e network (bandeira do cartao: visa,
mastercard, elo, amex, hipercard, other) na tabela accounts. Ambos opcionais.
"""
from alembic import op
import sqlalchemy as sa

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None

NETWORK_ENUM = sa.Enum(
    "visa", "mastercard", "elo", "amex", "hipercard", "other",
    name="cardnetwork",
    native_enum=False,
    length=16,
)


def upgrade() -> None:
    op.add_column("accounts", sa.Column("bank", sa.String(100), nullable=True))
    op.add_column("accounts", sa.Column("network", NETWORK_ENUM, nullable=True))


def downgrade() -> None:
    op.drop_column("accounts", "network")
    op.drop_column("accounts", "bank")
