"""add release_notes table (changelog loaded from docs/RELEASE_NOTES.md)

Revision ID: 0005_add_release_notes
Revises: 0004_add_picked
Create Date: 2026-09-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_add_release_notes"
down_revision = "0004_add_picked"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "release_notes",
        sa.Column("id", sa.String(length=128), primary_key=True),
        sa.Column("date", sa.String(length=16), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("heading", sa.String(length=500), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_release_notes_date", "release_notes", ["date"])


def downgrade() -> None:
    op.drop_index("ix_release_notes_date", table_name="release_notes")
    op.drop_table("release_notes")
