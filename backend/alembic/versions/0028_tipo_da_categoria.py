"""tipo da categoria: entrada ou saida

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-09

Categorias existentes nascem como "saida" (o caso mais comum): quem tiver uma categoria que na
verdade e de entrada pode trocar na tela depois.
"""
from alembic import op
import sqlalchemy as sa

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "categories",
        sa.Column(
            "kind",
            sa.Enum("expense", "revenue", name="categorykind", native_enum=False, length=16),
            nullable=False,
            server_default="expense",
        ),
    )
    op.alter_column("categories", "kind", server_default=None)


def downgrade() -> None:
    op.drop_column("categories", "kind")
