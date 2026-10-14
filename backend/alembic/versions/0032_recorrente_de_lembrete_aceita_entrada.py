"""recorrente de lembrete aceita entrada, nao so saida (ex: salario)

Revision ID: 0032
Revises: 0031
Create Date: 2026-10-14

As ja existentes do modo de lembrete eram sempre despesa (so havia "conta a pagar"); viram
"withdrawal". As do modo automatico nao usam esta coluna: o sentido ja esta no `template`.
"""
from alembic import op
import sqlalchemy as sa

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "recurrences",
        sa.Column(
            "type",
            sa.Enum("withdrawal", "deposit", "transfer", "opening_balance", name="transactiontype", native_enum=False, length=32),
            nullable=True,
            server_default="withdrawal",
        ),
    )
    op.execute("UPDATE recurrences SET type = NULL WHERE auto_create")
    op.alter_column("recurrences", "type", server_default=None)

    op.create_check_constraint(
        op.f("ck_recurrences_type_is_withdrawal_or_deposit"),
        "recurrences",
        "type IS NULL OR type IN ('withdrawal', 'deposit')",
    )
    op.create_check_constraint(
        op.f("ck_recurrences_type_matches_mode"),
        "recurrences",
        "(auto_create AND type IS NULL) OR (NOT auto_create AND type IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_recurrences_type_matches_mode"), "recurrences", type_="check")
    op.drop_constraint(op.f("ck_recurrences_type_is_withdrawal_or_deposit"), "recurrences", type_="check")
    op.drop_column("recurrences", "type")
