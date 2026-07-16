"""add lifted picked column to cases (+ updated_at index) and backfill from payloads

Revision ID: 0004_add_picked
Revises: 0003_add_events
Create Date: 2026-07-16
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "0004_add_picked"
down_revision = "0003_add_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cases", sa.Column("picked", sa.Boolean(), nullable=True))
    op.create_index("ix_cases_picked", "cases", ["picked"])
    # updated_at now backs the ?since= delta endpoint — index it too.
    op.create_index("ix_cases_updated_at", "cases", ["updated_at"])

    # Backfill from the JSON payloads in Python — portable across SQLite/PostgreSQL/MySQL
    # (no dialect-specific JSON SQL). Row counts here are small (one team's cases).
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, payload FROM cases")).fetchall()
    upd = sa.text("UPDATE cases SET picked = :picked WHERE id = :id")
    for cid, payload in rows:
        try:
            data = payload if isinstance(payload, dict) else json.loads(payload)
        except (TypeError, ValueError):
            data = {}
        bind.execute(upd, {"picked": data.get("agentStatus") == "queued", "id": cid})


def downgrade() -> None:
    op.drop_index("ix_cases_updated_at", table_name="cases")
    op.drop_index("ix_cases_picked", table_name="cases")
    op.drop_column("cases", "picked")
