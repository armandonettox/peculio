"""relatorios salvos: agrupamento, medida, grafico, periodo e filtros de um relatorio personalizado

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def _enum(name: str, *values: str):
    return sa.Enum(*values, name=name, native_enum=False, length=16)


def upgrade() -> None:
    op.create_table(
        "saved_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("group_by", _enum("reportgroupby", "category", "tag", "budget", "account", "counterparty", "month"), nullable=False),
        sa.Column("chart", _enum("reportchart", "table", "bar", "line", "donut"), nullable=False),
        sa.Column("measure", _enum("reportmeasure", "expense", "income", "net"), nullable=False),
        sa.Column(
            "period",
            _enum("reportperiod", "this-month", "last-month", "this-year", "last-3-months", "last-12-months", "fixed"),
            nullable=False,
        ),
        sa.Column("date_from", sa.Date(), nullable=True),
        sa.Column("date_to", sa.Date(), nullable=True),
        sa.Column("account_id", sa.Uuid(), nullable=True),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("tag_id", sa.Uuid(), nullable=True),
        sa.Column("budget_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("(period = 'fixed') = (date_from IS NOT NULL AND date_to IS NOT NULL)", name=op.f("ck_saved_reports_dates_match_period")),
        sa.CheckConstraint("date_from IS NULL OR date_to IS NULL OR date_from <= date_to", name=op.f("ck_saved_reports_dates_in_order")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_saved_reports_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_saved_reports")),
    )
    op.create_index("ix_saved_reports_user_id", "saved_reports", ["user_id"])
    op.create_index("uq_saved_reports_user_id_lower_name", "saved_reports", ["user_id", sa.literal_column("lower(name)")], unique=True)


def downgrade() -> None:
    op.drop_index("uq_saved_reports_user_id_lower_name", table_name="saved_reports")
    op.drop_index("ix_saved_reports_user_id", table_name="saved_reports")
    op.drop_table("saved_reports")
