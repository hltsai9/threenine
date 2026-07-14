"""add events table (usage analytics)

Revision ID: 0003_add_events
Revises: 0002_add_config
Create Date: 2026-07-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_add_events"
down_revision = "0002_add_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("operator_id", sa.String(length=64), nullable=True),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("case_id", sa.String(length=64), nullable=True),
        sa.Column("detail", sa.JSON(), nullable=False),
    )
    op.create_index("ix_events_at", "events", ["at"])
    op.create_index("ix_events_operator_id", "events", ["operator_id"])
    op.create_index("ix_events_kind", "events", ["kind"])
    op.create_index("ix_events_case_id", "events", ["case_id"])


def downgrade() -> None:
    op.drop_index("ix_events_case_id", table_name="events")
    op.drop_index("ix_events_kind", table_name="events")
    op.drop_index("ix_events_operator_id", table_name="events")
    op.drop_index("ix_events_at", table_name="events")
    op.drop_table("events")
