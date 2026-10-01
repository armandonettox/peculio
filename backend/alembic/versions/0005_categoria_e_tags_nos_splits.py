"""categoria e tags nos splits

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-01
"""
from alembic import op
import sqlalchemy as sa


revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('transaction_splits', sa.Column('category_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f('fk_transaction_splits_category_id_categories'),
        'transaction_splits', 'categories', ['category_id'], ['id'], ondelete='SET NULL',
    )
    op.create_table('transaction_split_tags',
    sa.Column('transaction_split_id', sa.Uuid(), nullable=False),
    sa.Column('tag_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], name=op.f('fk_transaction_split_tags_tag_id_tags'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['transaction_split_id'], ['transaction_splits.id'], name=op.f('fk_transaction_split_tags_transaction_split_id_transaction_splits'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('transaction_split_id', 'tag_id', name=op.f('pk_transaction_split_tags'))
    )


def downgrade() -> None:
    op.drop_table('transaction_split_tags')
    op.drop_constraint(op.f('fk_transaction_splits_category_id_categories'), 'transaction_splits', type_='foreignkey')
    op.drop_column('transaction_splits', 'category_id')
