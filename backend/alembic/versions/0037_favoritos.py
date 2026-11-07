"""favoritos: descricao favorita com categoria e conta

Revision ID: 0037
Revises: 0036
Create Date: 2026-11-07

Tabela nova favorites. Nao mexe em nenhum dado que ja existe.
"""
from alembic import op
import sqlalchemy as sa

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "favorites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("description", sa.String(255), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("account_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_favorites")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_favorites_user_id_users"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["category_id"], ["categories.id"], name=op.f("fk_favorites_category_id_categories"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"], name=op.f("fk_favorites_account_id_accounts"), ondelete="SET NULL"
        ),
    )
    op.create_index(
        "uq_favorites_user_id_type_lower_description",
        "favorites",
        ["user_id", "type", sa.text("lower(description)")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_favorites_user_id_type_lower_description", table_name="favorites")
    op.drop_table("favorites")
