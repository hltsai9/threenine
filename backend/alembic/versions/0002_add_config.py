"""add config table (shifts / owners board config)

Revision ID: 0002_add_config
Revises: 0001_init
Create Date: 2026-06-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_add_config"
down_revision = "0001_init"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "config",
        sa.Column("key", sa.String(length=64), primary_key=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("config")
