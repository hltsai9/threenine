"""initial cases table

Revision ID: 0001_init
Revises:
Create Date: 2026-06-06
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cases",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("status", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
    )
    op.create_index("ix_cases_status", "cases", ["status"])
    op.create_index("ix_cases_created_at", "cases", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_cases_created_at", table_name="cases")
    op.drop_index("ix_cases_status", table_name="cases")
    op.drop_table("cases")
