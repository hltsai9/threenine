# Project rules for Claude Code sessions

Read this first. These rules keep every session consistent — follow them even when not
asked. They are partly enforced by hooks in `.claude/hooks/` (see **Harness** below).

## What this repo is

A click-through **Case Tracker** prototype (zero-dependency vanilla JS + CSS in `prototype/`)
plus an optional Python backend. There are two backends: the single-user live proxy
(`local/serve.py`) and the decoupled ingest→DB→API pipeline (`backend/`). For *how to run,
credentials, and env vars*, see **@docs/SETUP.md** — do not restate that content elsewhere.
Per-area detail lives in [`README.md`](README.md), [`local/README.md`](local/README.md),
[`backend/README.md`](backend/README.md).

## The three rules

1. **Release notes on every code change (required).** Any change under `prototype/`, `local/`,
   `backend/`, or `deploy/` gets an entry in [`docs/RELEASE_NOTES.md`](docs/RELEASE_NOTES.md),
   **newest first, under today's date**, using the existing headings: **Added · Fixed ·
   Changed · Internal · Docs**. If a change genuinely needs no note (pure test/doc tweak),
   say why instead of skipping silently. *(Enforced by the Stop hook.)*

2. **One TODO home.** All TODOs, backlog items, and checklists go in
   [`docs/improvement-plan.md`](docs/improvement-plan.md). **Never create a new per-folder
   TODO file.**

3. **Don't duplicate docs.** Setup, credentials, run, and env-var instructions live **once**
   in [`docs/SETUP.md`](docs/SETUP.md); link to it instead of repeating. Each README covers
   only what's unique to its area.

## Workflow conventions

- **Branch:** develop on `claude/<descriptor>` branches; never push to a different branch
  without explicit permission. Don't open a PR unless asked.
- **Tests:** run `node prototype/tests/run.cjs` (zero-dependency) after code changes.
  *(The Stop hook also runs these and blocks on failure.)*
- **Rebundle:** after editing any `prototype/` source, regenerate the single-file build with
  `node prototype/bundle.mjs`. *(The PostToolUse hook does this automatically.)*
- **Seed data:** to change demo data, use the **`generate-data-js`** skill rather than editing
  `prototype/data.js` by hand.
- **End-of-change ritual:** the **`/ship`** skill does release-note → tests → rebundle →
  commit in one step.
- **Privacy:** never commit `local/secrets.local.json` or a live-capture `prototype/data.js`
  (one with `CASES_LIVE_CAPTURE = true`).

## Harness (`.claude/`)

- `settings.json` registers the hooks below.
- **SessionStart** `sync-to-origin.sh` — fast-forwards a stale branch to its upstream (safe;
  never resets).
- **Stop** `release-note-reminder.sh` — blocks finishing if code changed without a release note.
- **Stop** `tests-before-finish.sh` — runs the test suite on code changes; blocks on failure.
- **PostToolUse** `rebundle-standalone.sh` — rebuilds `standalone.html` after a prototype edit.

Adjust or disable any hook via `/hooks`.
