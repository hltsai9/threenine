# TODO — finish the Case Center → board mapping

Resumable checklist for wiring live Case Center data. Pick up here in a new session.
Edit point for everything below: **`local/casecenter.py`**. Verify with the snippet at the
bottom. Full context: `local/README.md`.

## Status so far
- [x] Local live server (`local/serve.py`) + `/api/cases` endpoint
- [x] Frontend live-fetch + seed fallback + agent-layer merge (`prototype/app.js`)
- [x] `map_record()` wired to real fields: `caseId`, `subject`, `createDateTime`,
      `caseLevel`, `caseStatus`, `caseSubstatus`, `assignee.accountId`
- [x] **Status / priority value tables filled** (see below) — cases now land in the right
      columns and the board shows the real Case Center status.

## Resolved with the user (items 1–3)

### 1–2. caseStatus / caseSubstatus → column + label  ✅
caseStatus ∈ `Open · In-Progress · Wait Resolution · Close · Drop`; the only substatus seen
is `Wait User` / `Return` under `In-Progress`. Mapped in `local/casecenter.py`:

| Case Center (status + substatus) | board column (`status`) |
| --- | --- |
| Open | new |
| In-Progress | new *(operator moves it to with_fit / with_hq)* |
| In-Progress · Return | new *(requester returned the case to IT)* |
| In-Progress · Wait User | returned_to_requester |
| Wait Resolution | with_hq |
| Close | closed |
| Drop | cancelled |

- The **visible status label** is the raw `caseStatus + caseSubstatus` concatenation
  (e.g. `In-Progress Wait User`) via `map_record()` → `ccStatusLabel`, shown by
  `displayStatus()` in `app.js`. The pill **colour/column** uses the mapped enum.
- Two coarseness decisions (change in `casecenter.py` if you disagree):
  - `In-Progress Wait User` → `returned_to_requester` (same "Sanity Check / With Requester"
    column as `sanity_check`, so the column is identical either way).
  - `Close` → `closed` (rather than `resolved`).

### 3. caseLevel → priority  ✅
`Normal → medium`, `Urgent → high` (`LEVEL_MAP` in `local/casecenter.py`).

## Polish (items 4–6)  ✅

### 4. People & departments  ✅
Mapped in `map_record()` and shown on the case detail Routing section (and the card's
owner slot falls back to the assignee when there's no FIT/HQ owner):
- `customField.userAccount` / `userDept` → **requester** (+ `requesterDept`) — the end user.
- `reporter.accountId` / `deptName` → **reporterId** / **reporterDept**.
- `assignee.accountId` / `deptName` → **assigneeId** / **assigneeDept**.
- Open item: these show the raw `accountId`. If you have an `accountId → display name`
  lookup (or a CC user endpoint), wire it in `map_record()` to show names instead of ids.

### 5. Case link  ✅
`BASE_URL` constant at the top of `local/casecenter.py` (or `CASE_CENTER_BASE_URL` env var)
— **fill it in**; `build_case_link()` appends the `caseId`. Adjust the pattern there if your
URL needs e.g. `?id=`.

### 6. createDateTime format  ✅
Confirmed GMT ISO-8601 with millis/offset (`2026-06-04T20:57:18.742+00:00`). The browser
parses it directly and renders it in local time — no conversion needed; passed through as
`createdAt` / `slaStartedAt`.

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
