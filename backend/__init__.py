"""Case Tracker back end: ingestion → database → read/write API.

This package decouples the front end from Case Center. The ingestion script
(`backend.ingest`) is the only component that holds Case Center credentials; it
writes cases into a database. The API (`backend.api`) and the static SPA only
read/write that database, so end users never configure an API key or cookie.

The same code runs on SQLite (demos) and PostgreSQL/MySQL (production) — the
database is selected entirely by the DATABASE_URL environment variable.
"""
