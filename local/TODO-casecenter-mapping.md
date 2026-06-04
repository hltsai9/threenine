# TODO — finish the Case Center → board mapping

Resumable checklist for wiring live Case Center data. Pick up here in a new session.
Edit point for everything below: **`local/casecenter.py`**. Verify with the snippet at the
bottom. Full context: `local/README.md`.

## Status so far
- [x] Local live server (`local/serve.py`) + `/api/cases` endpoint
- [x] Frontend live-fetch + seed fallback + agent-layer merge (`prototype/app.js`)
- [x] `map_record()` wired to real fields: `caseId`, `subject`, `createDateTime`,
      `caseLevel`, `caseStatus`, `caseSubstatus`, `assignee.accountId`
- [ ] **Value tables still empty** → every case currently lands in **New** / **medium**

## Needed from the user (blockers)

### 1. caseStatus values
- [ ] List every possible `caseStatus` string.

### 2. caseSubstatus values + status mapping
- [ ] List every possible `caseSubstatus` string (and which `caseStatus` each pairs with).
- [ ] For each (caseStatus, caseSubstatus), say which board column it is:
      `new | with_fit | with_hq | sanity_check | returned_to_requester | resolved | closed | cancelled`.
- [ ] Confirm which field distinguishes **With Local FIT** vs **With HQ Product Team**
      (hunch: `caseSubstatus`).
- [ ] Fill `STATUS_MAP` (keyed on `(caseStatus, caseSubstatus)`) and
      `STATUS_MAP_BY_STATUS` (caseStatus-only fallback) in `local/casecenter.py`.

### 3. caseLevel → priority
- [ ] List `caseLevel` values (e.g. P1/P2/P3 or 1/2/3).
- [ ] Map each to `high | medium | low`; fill `LEVEL_MAP` in `local/casecenter.py`.

## Polish (confirm if they matter)

### 4. Requester & assignee
- [ ] Is there a **requester/reporter** field to show? (Not in the field list → blank today.)
- [ ] Turn `assignee.accountId` into a readable name/team? If yes, need an
      `accountId → name` lookup or a Case Center user endpoint. If no, leave as `assigneeId`
      (the column already conveys FIT vs HQ).

### 5. Case link
- [ ] Is there a URL field, or a pattern to build from `caseId`
      (e.g. `https://case-center.internal/cases/{caseId}`)? Set `caseLink` in `map_record()`.

### 6. createDateTime format
- [ ] Confirm it's ISO-8601 like `2026-06-05T05:12:00Z`. If epoch ms / other, add a
      conversion in `map_record()` so the SLA clock is correct.

## Live-mode gaps from later features (timeline, owner-hold, SLA, archive)

### 7. Ownership history → timeline + FIT/HQ time
The case detail's **ownership timeline** and the **Local FIT / HQ Product Team** clocks are
reconstructed from `c.history` (see `ownershipSegments()` in `app.js`). Live cases come back
with `history: []`, so today the timeline shows the empty-state note and FIT/HQ read **0m**.
- [ ] If Case Center exposes a status/assignment **audit log**, map it in `map_record()` into
      a `history` array of `{ at: <ISO>, who, kind, detail }`. `ownershipSegments()` understands
      these `kind`s (and parses `detail` for the ambiguous ones):
      `created` → first line · `assigned` → Local FIT · `escalated` (detail `FIT → HQ …`) → HQ ·
      `status` (detail contains `Sanity Check`) → sanity · `returned` → with requester ·
      `resumed` (detail names FIT/HQ/Sanity) · `closed` / `cancelled`.
- [ ] This also populates the **History** list on the detail page.

### 8. Owner / routing (FIT vs HQ attribution)
Live cases set no `fitId` / `hqId` / `currentOwner`, so cards show "unassigned" and the
"Holding now" indicator never lights up.
- [ ] Decide how `assignee.accountId` (and team) maps to the board's owner model: either
      map to local `OWNERS` ids in `data.js`, or just display the assignee name, and set
      `currentOwner` to `'fit'` / `'hq'` so the active-owner clock/column are correct.

### 9. SLA accuracy for live cases
In live mode `caseSlaMs()` just runs from `createDateTime` — it does **not** pause for
"returned to requester" or bank segments, because there are no transitions.
- [ ] If Case Center reports a real process/on-us time or pause windows, map them
      (e.g. set `slaAccumulatedMs` / `slaPaused`, or derive from the audit log in #7).
      Otherwise the SLA clock = wall-clock since created.

### 10. Weekly Archive bucketing
`normalizeLiveCase()` (in `app.js`) defaults every live case's `weekId` to the current week,
so older cases won't show under past weeks or in archive stats.
- [ ] If you want week bucketing, derive `weekId` from `createDateTime` against `window.WEEKS`
      (in `map_record()` or `normalizeLiveCase()`).

### 11. Refresh cadence & cookie expiry (nice-to-have)
Data is pulled on page load/refresh only.
- [ ] Optional: add an auto-refresh interval or a manual "Refresh" button.
- [ ] Surface a clear banner when `/api/cases` fails (e.g. cookie expired → 500) instead of
      silently falling back to seed data.

## Also still open (separate task)
- [ ] `fetch_raw()` in `local/casecenter.py` — paste the real Case Center request and
      `return x_json["data"]`. (Credentials come from env vars or `secrets.local.json`.)

## How to verify after filling the tables
```bash
python3 -c "
import sys; sys.path.insert(0,'local'); import casecenter as cc, json
rec = {'caseId':1,'subject':'t','createDateTime':'2026-06-05T05:12:00Z',
       'caseLevel':'<a real level>','caseStatus':'<a real status>',
       'caseSubstatus':'<a real substatus>','assignee':{'accountId':'a1'}}
print(json.dumps(cc.map_record(rec), indent=2))   # expect correct status + priority
"
```
Then run `python3 local/serve.py` and open http://127.0.0.1:8787/ — cases should land in the
right columns. (Public Pages site stays on seed data; live mode is local only.)
