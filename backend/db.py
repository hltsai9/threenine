"""Database layer (SQLAlchemy). One model, one connection — portable across
SQLite (demo) and PostgreSQL/MySQL (production) via the DATABASE_URL env var.

    DATABASE_URL examples
    ---------------------
    sqlite:///./casetracker.db                      (demo, the default)
    postgresql+psycopg://user:pass@host:5432/cases  (production)
    mysql+pymysql://user:pass@host:3306/cases       (production)

A case is stored as a single JSON `payload` (the board-shaped object the SPA
consumes) plus a few scalar columns lifted out of it for indexing/sorting. This
mirrors how the previous file-based store kept one merged object per case
(see local/persist.py) — Case-Center-owned fields and the operator/agent layer
live together, and the merge rules in backend/merge.py decide who may write what.
"""
import os

from sqlalchemy import DateTime, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.types import JSON

# Repo root (one level up from this file), so the default SQLite file and the
# frontend/ webroot resolve no matter where the process is started from.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DEFAULT_SQLITE = "sqlite:///" + os.path.join(REPO_ROOT, "casetracker.db")
DATABASE_URL = os.environ.get("DATABASE_URL", DEFAULT_SQLITE)

# Managed Postgres providers (Render, Heroku, …) hand out `postgres://` or `postgresql://`
# URLs. SQLAlchemy rejects the former and maps the latter to psycopg2 — the driver we do NOT
# bundle. Normalise both to the psycopg (v3) driver in requirements.txt so the provider's URL
# can be pasted verbatim. (alembic/env.py imports this value, so migrations get it too.)
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgres://"):]
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgresql://"):]

# SQLite + a threaded web server need check_same_thread off; other drivers ignore it.
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, future=True, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, future=True)


class Base(DeclarativeBase):
    pass


class Case(Base):
    __tablename__ = "cases"

    # Case id (e.g. "C-1041"). Stable primary key shared by ingestion and the API.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # Lifted out of payload for cheap filtering/sorting. created_at may be NULL if a
    # record had no parseable createdAt.
    status: Mapped[str | None] = mapped_column(String(40), index=True, nullable=True)
    created_at: Mapped["DateTime | None"] = mapped_column(DateTime(timezone=True), index=True, nullable=True)
    updated_at: Mapped["DateTime | None"] = mapped_column(DateTime(timezone=True), nullable=True)
    # The full board-shaped case object. JSON maps to native JSON on PG/MySQL and to
    # TEXT-encoded JSON on SQLite — same code, every backend.
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class Config(Base):
    """Shared board configuration that isn't a case: the shift roster/rota ("shifts") and the
    owner directory + Route Board department lists ("owners"). One row per config key, the whole
    block stored as a single JSON payload — so the Shifts/Owners pages can save to the DB and every
    operator/device reads the same config (the bundled shifts.js / owners.js become the fallback)."""
    __tablename__ = "config"

    # Config key: "shifts" or "owners".
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    updated_at: Mapped["DateTime | None"] = mapped_column(DateTime(timezone=True), nullable=True)
    # The full config block (board-shaped), e.g. {operators, shifts, currentOperatorId, rota,
    # rotaByWeek} for "shifts" or {owners, ccCoreDepartments, …} for "owners".
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


def init_db() -> None:
    """Create tables if they don't exist. Used for demos/SQLite; production should
    prefer `alembic upgrade head` and may set AUTO_CREATE=0 to skip this."""
    Base.metadata.create_all(engine)
