"""moedas contas e livro caixa

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-30 22:47:52.088590
"""
from alembic import op
import sqlalchemy as sa


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


# Moedas iniciais: (codigo ISO 4217, nome, simbolo, casas decimais)
CURRENCIES = [
    ("BRL", "Real brasileiro", "R$", 2),
    ("USD", "Dolar americano", "US$", 2),
    ("EUR", "Euro", "EUR", 2),
    ("GBP", "Libra esterlina", "GBP", 2),
    ("ARS", "Peso argentino", "ARS", 2),
    ("CAD", "Dolar canadense", "CA$", 2),
    ("AUD", "Dolar australiano", "A$", 2),
    ("CHF", "Franco suico", "CHF", 2),
    ("MXN", "Peso mexicano", "MX$", 2),
    ("JPY", "Iene japones", "JPY", 0),
]


def upgrade() -> None:
    currencies = op.create_table('currencies',
    sa.Column('code', sa.String(length=3), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('symbol', sa.String(length=8), nullable=False),
    sa.Column('decimal_places', sa.Integer(), server_default='2', nullable=False),
    sa.PrimaryKeyConstraint('code', name=op.f('pk_currencies'))
    )
    # Precisa vir antes da chave estrangeira de users.default_currency: os usuarios que ja
    # existem nascem com BRL e essa moeda tem que estar na tabela.
    op.bulk_insert(
        currencies,
        [{"code": c, "name": n, "symbol": s, "decimal_places": d} for c, n, s, d in CURRENCIES],
    )
    op.create_table('accounts',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('type', sa.Enum('asset', 'liability', 'expense', 'revenue', 'initial_balance', 'reconciliation', name='accounttype', native_enum=False, length=32), nullable=False),
    sa.Column('role', sa.Enum('checking', 'savings', 'cash', 'credit_card', 'other', 'loan', 'debt', 'mortgage', name='accountrole', native_enum=False, length=32), nullable=True),
    sa.Column('currency_code', sa.String(length=3), nullable=False),
    sa.Column('active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('iban', sa.String(length=34), nullable=True),
    sa.Column('account_number', sa.String(length=64), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['currency_code'], ['currencies.code'], name=op.f('fk_accounts_currency_code_currencies')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_accounts_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_accounts')),
    sa.UniqueConstraint('user_id', 'type', 'name', name='uq_accounts_user_type_name')
    )
    op.create_index(op.f('ix_accounts_user_id'), 'accounts', ['user_id'], unique=False)
    op.create_table('transactions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_transactions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_transactions'))
    )
    op.create_index(op.f('ix_transactions_user_id'), 'transactions', ['user_id'], unique=False)
    op.create_table('transaction_splits',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('transaction_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('type', sa.Enum('withdrawal', 'deposit', 'transfer', 'opening_balance', 'reconciliation', name='transactiontype', native_enum=False, length=32), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('description', sa.String(length=255), nullable=False),
    sa.Column('source_account_id', sa.Uuid(), nullable=False),
    sa.Column('destination_account_id', sa.Uuid(), nullable=False),
    sa.Column('amount', sa.Numeric(precision=18, scale=2), nullable=False),
    sa.Column('currency_code', sa.String(length=3), nullable=False),
    sa.Column('foreign_amount', sa.Numeric(precision=18, scale=2), nullable=True),
    sa.Column('foreign_currency_code', sa.String(length=3), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('(foreign_amount IS NULL) = (foreign_currency_code IS NULL)', name=op.f('ck_transaction_splits_foreign_amount_and_currency_together')),
    sa.CheckConstraint('amount > 0', name=op.f('ck_transaction_splits_amount_positive')),
    sa.CheckConstraint('foreign_amount IS NULL OR foreign_amount > 0', name=op.f('ck_transaction_splits_foreign_amount_positive')),
    sa.CheckConstraint('source_account_id <> destination_account_id', name=op.f('ck_transaction_splits_source_differs_from_destination')),
    sa.ForeignKeyConstraint(['currency_code'], ['currencies.code'], name=op.f('fk_transaction_splits_currency_code_currencies')),
    sa.ForeignKeyConstraint(['destination_account_id'], ['accounts.id'], name=op.f('fk_transaction_splits_destination_account_id_accounts'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['foreign_currency_code'], ['currencies.code'], name=op.f('fk_transaction_splits_foreign_currency_code_currencies')),
    sa.ForeignKeyConstraint(['source_account_id'], ['accounts.id'], name=op.f('fk_transaction_splits_source_account_id_accounts'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['transaction_id'], ['transactions.id'], name=op.f('fk_transaction_splits_transaction_id_transactions'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_transaction_splits_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_transaction_splits'))
    )
    op.create_index('ix_transaction_splits_destination_account_id_date', 'transaction_splits', ['destination_account_id', 'date'], unique=False)
    op.create_index('ix_transaction_splits_source_account_id_date', 'transaction_splits', ['source_account_id', 'date'], unique=False)
    op.create_index(op.f('ix_transaction_splits_transaction_id'), 'transaction_splits', ['transaction_id'], unique=False)
    op.create_index('ix_transaction_splits_user_id_date', 'transaction_splits', ['user_id', 'date'], unique=False)
    op.add_column('users', sa.Column('default_currency', sa.String(length=3), server_default='BRL', nullable=False))
    op.create_foreign_key(op.f('fk_users_default_currency_currencies'), 'users', 'currencies', ['default_currency'], ['code'])


def downgrade() -> None:
    op.drop_constraint(op.f('fk_users_default_currency_currencies'), 'users', type_='foreignkey')
    op.drop_column('users', 'default_currency')
    op.drop_index('ix_transaction_splits_user_id_date', table_name='transaction_splits')
    op.drop_index(op.f('ix_transaction_splits_transaction_id'), table_name='transaction_splits')
    op.drop_index('ix_transaction_splits_source_account_id_date', table_name='transaction_splits')
    op.drop_index('ix_transaction_splits_destination_account_id_date', table_name='transaction_splits')
    op.drop_table('transaction_splits')
    op.drop_index(op.f('ix_transactions_user_id'), table_name='transactions')
    op.drop_table('transactions')
    op.drop_index(op.f('ix_accounts_user_id'), table_name='accounts')
    op.drop_table('accounts')
    op.drop_table('currencies')
