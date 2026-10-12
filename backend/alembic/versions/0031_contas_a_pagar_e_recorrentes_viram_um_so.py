"""contas a pagar e recorrentes viram um so: lembrete ou criacao automatica, pelo mesmo registro

Revision ID: 0031
Revises: 0030
Create Date: 2026-10-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("recurrences", sa.Column("auto_create", sa.Boolean(), server_default=sa.true(), nullable=False))
    op.add_column("recurrences", sa.Column("currency_code", sa.String(), nullable=True))
    op.add_column("recurrences", sa.Column("amount_min", sa.Numeric(precision=18, scale=2), nullable=True))
    op.add_column("recurrences", sa.Column("amount_max", sa.Numeric(precision=18, scale=2), nullable=True))
    op.add_column("recurrences", sa.Column("match_text", sa.String(length=100), nullable=True))
    op.create_foreign_key(
        op.f("fk_recurrences_currency_code_currencies"), "recurrences", "currencies", ["currency_code"], ["code"]
    )
    # Sem isto, o template de uma conta a pagar (sempre NULL) violaria a constraint antiga de recorrente
    op.alter_column("recurrences", "template", existing_type=sa.JSON(), nullable=True)

    # Conta a pagar vira uma recorrente do modo de lembrete (auto_create = false), com o mesmo id:
    # assim o bill_id dos lancamentos ja ligados continua valendo sem precisar trocar linha por linha
    op.execute(
        """
        INSERT INTO recurrences (
            id, user_id, name, frequency, first_date, end_date, max_occurrences, active,
            auto_create, template, next_index, next_date, last_error,
            currency_code, amount_min, amount_max, match_text, created_at
        )
        SELECT
            id, user_id, name, frequency, first_due_date, NULL, NULL, active,
            false, NULL, 0, NULL, NULL,
            currency_code, amount_min, amount_max, match_text, created_at
        FROM bills
        """
    )

    op.drop_constraint(op.f("fk_transaction_splits_bill_id_bills"), "transaction_splits", type_="foreignkey")
    op.create_foreign_key(
        op.f("fk_transaction_splits_bill_id_recurrences"),
        "transaction_splits",
        "recurrences",
        ["bill_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.drop_table("bills")

    op.create_check_constraint(op.f("ck_recurrences_amount_min_positive"), "recurrences", "amount_min IS NULL OR amount_min > 0")
    op.create_check_constraint(
        op.f("ck_recurrences_amount_max_at_least_min"),
        "recurrences",
        "amount_max IS NULL OR amount_min IS NULL OR amount_max >= amount_min",
    )
    op.create_check_constraint(
        op.f("ck_recurrences_mode_matches_fields"),
        "recurrences",
        "(auto_create AND template IS NOT NULL) "
        "OR (NOT auto_create AND amount_min IS NOT NULL AND amount_max IS NOT NULL AND currency_code IS NOT NULL)",
    )
    op.create_index(
        "uq_recurrences_user_id_lower_name",
        "recurrences",
        ["user_id", sa.literal_column("lower(name)")],
        unique=True,
        postgresql_where=sa.text("NOT auto_create"),
    )

    # A partir de agora cada recorrente nova decide o modo; o default so serviu para preencher as
    # ja existentes (que sao todas automaticas, pois so havia o modelo antigo)
    op.alter_column("recurrences", "auto_create", server_default=None)


def downgrade() -> None:
    op.drop_index("uq_recurrences_user_id_lower_name", table_name="recurrences")
    op.drop_constraint(op.f("ck_recurrences_mode_matches_fields"), "recurrences", type_="check")
    op.drop_constraint(op.f("ck_recurrences_amount_max_at_least_min"), "recurrences", type_="check")
    op.drop_constraint(op.f("ck_recurrences_amount_min_positive"), "recurrences", type_="check")

    op.create_table(
        "bills",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("currency_code", sa.String(), nullable=False),
        sa.Column("amount_min", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("amount_max", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("match_text", sa.String(length=100), nullable=True),
        sa.Column("first_due_date", sa.Date(), nullable=False),
        sa.Column(
            "frequency",
            sa.Enum("weekly", "monthly", "quarterly", "half_yearly", "yearly", name="billfrequency", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("amount_min > 0", name=op.f("ck_bills_amount_min_positive")),
        sa.CheckConstraint("amount_max >= amount_min", name=op.f("ck_bills_amount_max_at_least_min")),
        sa.ForeignKeyConstraint(["currency_code"], ["currencies.code"], name=op.f("fk_bills_currency_code_currencies")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_bills_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_bills")),
    )
    op.create_index("uq_bills_user_id_lower_name", "bills", ["user_id", sa.literal_column("lower(name)")], unique=True)

    op.execute(
        """
        INSERT INTO bills (id, user_id, name, currency_code, amount_min, amount_max, match_text, first_due_date, frequency, active, created_at)
        SELECT id, user_id, name, currency_code, amount_min, amount_max, match_text, first_date, frequency, active, created_at
        FROM recurrences
        WHERE NOT auto_create
        """
    )

    op.drop_constraint(op.f("fk_transaction_splits_bill_id_recurrences"), "transaction_splits", type_="foreignkey")
    op.create_foreign_key(
        op.f("fk_transaction_splits_bill_id_bills"), "transaction_splits", "bills", ["bill_id"], ["id"], ondelete="SET NULL"
    )

    op.execute("DELETE FROM recurrences WHERE NOT auto_create")

    op.drop_constraint(op.f("fk_recurrences_currency_code_currencies"), "recurrences", type_="foreignkey")
    op.drop_column("recurrences", "match_text")
    op.drop_column("recurrences", "amount_max")
    op.drop_column("recurrences", "amount_min")
    op.drop_column("recurrences", "currency_code")
    op.drop_column("recurrences", "auto_create")
    op.alter_column("recurrences", "template", existing_type=sa.JSON(), nullable=False)
