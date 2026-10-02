"""regras

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rule_groups",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_rule_groups_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_rule_groups")),
    )
    op.create_index("uq_rule_groups_user_id_lower_name", "rule_groups", ["user_id", sa.text("lower(name)")], unique=True)
    op.create_table(
        "rules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("match_mode", sa.Enum("all", "any", name="matchmode", native_enum=False, length=8), nullable=False),
        sa.Column("stop_processing", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("triggers", sa.JSON(), nullable=False),
        sa.Column("actions", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["rule_groups.id"], name=op.f("fk_rules_group_id_rule_groups"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_rules_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_rules")),
    )
    op.create_index("uq_rules_user_id_lower_name", "rules", ["user_id", sa.text("lower(name)")], unique=True)
    op.create_index("ix_rules_group_id", "rules", ["group_id"])


def downgrade() -> None:
    op.drop_index("ix_rules_group_id", table_name="rules")
    op.drop_index("uq_rules_user_id_lower_name", table_name="rules")
    op.drop_table("rules")
    op.drop_index("uq_rule_groups_user_id_lower_name", table_name="rule_groups")
    op.drop_table("rule_groups")
