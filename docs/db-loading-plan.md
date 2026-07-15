# Plan: faster board loading from the database

> Requested 2026-07-14 (improvement-plan §6): boot "takes too long to load". This doc measures
> where the time goes and proposes staged fixes. **Stage 0 (gzip) is already implemented**; the
> stages below it await sign-off.

## Where the time goes

Server-mode boot (`bootServerLoad` → `tryLoadLiveCases(true)`) fetches **`GET /api/cases` — the
entire store in one JSON response**: every case ever ingested, each carrying its full operator
history and Case Center process timeline. The payload grows without bound as weeks accumulate;
rendering only needs a fraction of it up front (the picked working set; the current week for
Overview).

Measured on a realistic synthetic store (400 cases, 5 history entries + 6 timeline stages each,
SQLite, localhost):

| Metric | Value |
| --- | --- |
| `GET /api/cases` raw JSON | **965 KB** (~2.4 KB/case) |
| Same response gzipped | **19.5 KB** (49× smaller) |

At a few thousand cases the raw payload reaches several MB — on a slow link that alone explains
"takes too long", before any DB or render cost.

## Stage 0 — compression (DONE, 2026-07-15)

`GZipMiddleware` added to `backend/api.py` (`minimum_size=1024`). No client change — browsers send
`Accept-Encoding: gzip` automatically. This turns the megabyte-class transfer into tens of KB and
is almost certainly the biggest single win. **Re-test the felt loading time after deploying this
before investing in the stages below.**

## Stage 1 — load the working set first (the "picked table" idea)

The user's suggestion, adapted: rather than a separate linked table, **lift `picked` into an
indexed scalar column** on `cases` (exactly how `status`/`created_at` are already lifted — see
`backend/db.py`), maintained on every write from `payload.agentStatus == 'queued'`.

- Migration `0004`: `picked Boolean` + index; backfill from payloads.
- `backend/merge.py` `_scalars_from()`: also derive `picked`.
- API: `GET /api/cases?scope=picked` → only picked cases; `?scope=rest` → the remainder.
- SPA boot: fetch `scope=picked` first → **board renders as soon as the working set arrives**
  (tens of cases, not thousands); then fetch `scope=rest` in the background and merge (Overview /
  archive fill in a second later). The existing `casesPromise` machinery in `bootServerLoad`
  already supports staged loading.

Why a lifted column instead of a second table: same query power, no join, no dual-write
consistency problem, and it follows the codebase's existing lifted-scalar pattern.

## Stage 2 — delta refreshes

`updated_at` is already a lifted, indexed column. Add `GET /api/cases?since=<ISO>`: rows with
`updated_at > since`. The SPA remembers the newest `updated_at` it has seen and polls/refreshes
with `?since=`, so steady-state refreshes carry only changed cases (usually a handful) instead of
the world. Cheap to add once Stage 1's query plumbing exists.

## Stage 3 — payload slimming (only if still needed)

`?fields=board`: strip `processTimeline` + `history` from list responses and lazy-load a case's
full payload when it's opened (`?id=` already returns one case). Biggest structural win (those two
fields dominate the 2.4 KB/case) but touches the most client code — clocks/exports need the full
payload, so the SPA must fetch-on-demand. Defer until measurements after Stages 0–2 justify it.

## Recommendation

Deploy Stage 0 (done) and measure. If boot still feels slow, implement **Stage 1 + Stage 2
together** (one migration, one API change, one boot-sequence change — roughly a half-day). Keep
Stage 3 in reserve.

## Found while measuring (side note)

`python -m backend.ingest --seed-from-data-js` currently inserts **0 rows** when `frontend/data.js`
holds raw-CC records (`CASES_RAW_CC = true`): the extractor emits objects keyed `caseId`, but
`upsert_operator` requires `id` and skips them. Demo-seeding worked only for board-shape data.js
files. Tracked in improvement-plan §6.
