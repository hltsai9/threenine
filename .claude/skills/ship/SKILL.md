---
name: ship
description: End-of-change ritual for the Case Tracker repo — add the release note, run tests, rebundle standalone.html, and commit (and push). Use when the user says "ship it", "wrap up", "finish this change", or asks to commit a completed change so it satisfies the project's release-note + test + bundle rules in one step.
---

# /ship — finish a change correctly

Run these steps in order. Stop and report if any step fails; do not commit a broken state.

1. **Determine what changed.** `git status --porcelain` and `git diff --stat`. Note whether any
   files under `prototype/`, `local/`, `backend/`, or `deploy/` changed (these require a release
   note) and whether any **bundled `prototype/` source** changed (these require a rebundle).

2. **Release note (required for code changes).** If code under those folders changed, add an entry
   to `docs/RELEASE_NOTES.md` **under today's date, newest first**, using the existing headings
   (**Added · Fixed · Changed · Internal · Docs**). Match the file's existing style (bold feature
   name, brief description). If today's date heading already exists, append under it. If the change
   is purely docs/tests and needs no note, say so explicitly rather than skipping silently.

3. **Tests.** Run `node prototype/tests/run.cjs`. All tests must pass before continuing.

4. **Rebundle if needed.** If any of `prototype/{app.js,styles.css,data.js,shifts.js,owners.js,config.js,tour.js,index.html,favicon.svg}`
   changed, run `node prototype/bundle.mjs` so `standalone.html` is current, and stage it.

5. **Commit.** Stage the change with `git add -A` and commit with a clear, descriptive message
   summarizing what changed and why. Keep to the repo's branch rules (work on the current
   `claude/<descriptor>` branch; never switch branches without permission). End the commit body
   with the required session trailer.

6. **Push only if the user asked** (or already authorized it): `git push -u origin <branch>` with
   the standard retry-on-network-error behavior. Do **not** open a pull request unless explicitly
   requested.

7. **Report** the release-note entry added, the test result, whether a rebundle happened, and the
   commit hash.

> The Stop hooks (`release-note-reminder.sh`, `tests-before-finish.sh`) enforce steps 2–3 — running
> `/ship` is just the clean way to satisfy them in one pass.
