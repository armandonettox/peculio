"""categorias e tags

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-30
"""
from alembic import op
import sqlalchemy as sa


revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('categories',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('color', sa.String(length=7), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'", name=op.f('ck_categories_color_hex')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_categories_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_categories'))
    )
    op.create_index('uq_categories_user_id_lower_name', 'categories', ['user_id', sa.literal_column('lower(name)')], unique=True)
    op.create_table('tags',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=50), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_tags_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_tags'))
    )
    op.create_index('uq_tags_user_id_lower_name', 'tags', ['user_id', sa.literal_column('lower(name)')], unique=True)


def downgrade() -> None:
    op.drop_index('uq_tags_user_id_lower_name', table_name='tags')
    op.drop_table('tags')
    op.drop_index('uq_categories_user_id_lower_name', table_name='categories')
    op.drop_table('categories')
