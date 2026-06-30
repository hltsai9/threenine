# Plan: Make the SPA a read-only Case Center overview + pick-for-follow-up + analytics

> **Status (2026-06-15):** 7 done, 1 unapplicable, 2 open.

## Context

Today the SPA looks like a parallel case-management tool: operators can change status, route to Core/HQ desks, escalate, chase owners, verify fixes, create new cases, etc. In reality, operators do all of that work in **Case Center** — re-doing it here is double bookkeeping with no payoff. The reason the platform exists is to add value *on top of* Case Center: surface cases that need more attention, let operators *pick* those for follow-up, and analyze the picked subset.

Reframing per the user:

- **Archive** (`#/archive`) is the full Case Center overview, browsable by week — read-only, where operators go to **pick** new cases for follow-up.
- **Picked workspace** (`#/cases`) stays the home route. Each shift's operator lands here first because they need to see what the previous shift handed over. It renders only **picked** cases in a new two-zone layout: an aggregate **Route Board** strip across the top, and a **list + detail** split across the bottom.
- **Every picked case carries two statuses: the *CC status* from Case Center and a *Track Status* set by the operator.** Track Status is a small fixed list (Weekend Case, HQ did not handle, Escalate to Core Team, Case Closed, Escalated to HQ — keep an eye, Need to contact user, Sanity Check). The first three have **scheduled handoff rules** telling the next shift's 1st-line operator when to reassign the case in Case Center (from the current assignee to a specific desired assignee). This is the platform's core value-add — it captures the operator's intent, which Case Center has no place to record.
- A **three-station Route Board** (User · Core Team · HQ) visualises every picked case on its own row: a dot at the current station, an arrow + animated dot for cases with a scheduled handoff, an eyeball icon for cases the operator is watching.
- **Track Status is set from a simple 7-item picker** on the case detail panel — the old CC-shaped action dropdown is dropped entirely. The picker shows all 7 names with a "Suggested for your shift" hint pill on the relevant ones.
- **Analytics** live in the archive view, splitting picked vs unpicked + time-on-us/SLA trends.
- **Keep** the operator-helper features that don't exist in Case Center: handover notes, reminders, shift/rota editor, owners editor (as a contact/TZ reference).
- **`+ New case` stays** as the manual-import affordance for older Case Center cases that fall outside the look-back window (it pulls a single case by ID; it never creates a case in Case Center).

Read-only is already supported end-to-end: `local/serve.py`, `local/casecenter.py`, `backend/ingest.py`, and `backend/api.py` have no write-back path to Case Center, and the existing `CC_OWNED_FIELDS` overlay protects the operator layer on refresh — no plumbing changes are needed in the ingest/backend tier.

## Recommended approach

### 1. New Picked workspace layout — ✅ **done** (`renderCasesView`/`renderPickedList`/`renderRouteBoardStrip` in `app.js`; `#/cases` is default Picked workspace, two-zone strip + list/detail split, empty-state points to Overview)

`#/cases` (Picked) is the default landing route. It is rewritten from the existing kanban-by-CC-status into a **single-screen two-zone layout** rendering only `agentStatus === 'queued'` cases:

- **Top zone — Aggregate Route Board (1/3 height).** Three station columns: *User · Core Team · HQ*. One row per picked case (clickable; selecting a row loads it into the detail panel below). Each row shows a dot at the case's current station (derived from CC `assigneeDept` via the dept→role mapping in `owners.js`), an arrow + animated dot when the Track Status implies a scheduled move, and an eyeball icon for "watching" track statuses. Full visual rules in section 6.
- **Bottom zone — List + Detail (2/3 height), split 1:2 width.**
  - **Left 1/3 — Picked case list.** Flat list, one row per picked case (mirrors the top Route Board rows). Each row shows: subject, CC status badge, Track Status pill, due-time chip when relevant. Default sort: **by Track Status group, then due time** within each group (overdue first, then due-this-shift, then upcoming, then untracked). The group order matches the Route Board's lane ordering — Weekend Case → HQ did not handle → Escalate to Core Team → Escalated to HQ → Need to contact user → Case Closed → untracked → Sanity Check (last, matching the collapsible bottom group). Filter chips above the list (CC status, Track Status, Due this shift, Overdue).
  - **Right 2/3 — Case detail panel.** The existing detail panel content (CC-owned fields read-only, history, handover note, reminder, **Track Status picker**, ownership timeline, SLA / hold clocks). One row is always selected; defaults to the topmost picked case.
- **Drop the CC status columns entirely.** The old kanban grouping is gone — CC status is just a badge on each row. The two-band (queued/unqueued) split is also gone since unpicked cases live in the Archive Overview.
- **Empty state.** When no cases are picked, the bottom zone collapses to a single empty-state panel that points the operator at Overview ("Open Overview to pick cases — they'll show up here.")
- Sidebar nav surfaces both routes: **Picked** (`#/cases`) on top, **Overview** (`#/archive`) just below.

`#/archive` becomes the full Case Center overview. The week index (W21…current) and week-detail view stay — they already enumerate every case Case Center has surfaced. This is where the operator goes to find new cases to pick.

Critical files: `frontend/app.js` (rewrite `renderCasesView` for the two-zone layout, new `renderRouteBoardStrip` / `renderPickedList` / reuse the existing detail panel), `renderArchiveIndex`, `renderArchiveWeek`, the sidebar nav block.

### 2. Make picking the central interaction — ✅ **done** (`isPicked`/`pickedCases`/`renderQueueToggleButton` reuse `agentStatus:'queued'`; UI says "Pick / Picked", Pick button in `renderArchiveWeek` table)

- Reuse the existing `agentStatus: 'queued' | 'unqueued'` flag and `toggleQueue` (in `app.js`) as the pick mechanism — no new field. Rename UI affordances from "Queue / Queued" to **"Pick / Picked"** so the operator-facing language matches the user's mental model.
- Add a `[Pick] / [Picked ✓]` button to every card in the archive week-detail table (`renderArchiveWeek`). Clicking pick is the *only* card-level mutation in archive view.
- On the Picked workspace, the toggle becomes "Unpick" (sends the case back to the archive overview).
- Picked state persists via the existing operator layer (`agent-v1` localStorage key + `POST /api/save`). No backend schema change.

Critical files: `frontend/app.js` (`toggleQueue`, `renderCard`, the archive table renderer).

### 3. Track Status — the operator's intent on each picked case (the core value-add) — ✅ **done** (`TRACK_STATUSES`, `c.trackStatus` in `agent-v1` (un)packing, `trackStatusPhase`/`actionDueCases`/`actionOverdueCases`, scheduled-handoff computation, 7-item picker + Clear with preconditions at `renderDetailActions` + clear-confirm at line ~4274)

- Add a single new operator-layer field to each case: **`trackStatus`** (enum, stored in the operator layer (`agent-v1` localStorage + `POST /api/save`), never sent to Case Center). Default = `null` (picked but not yet categorised).
- **Track Status values** (fixed list; this is what the operator chooses from the existing action surface):

  | Track Status | Meaning | Scheduled handoff? |
  | --- | --- | --- |
  | **Weekend Case** | Fri/Sat case held by ops until Sunday hand-off to HQ. | Yes — User → HQ, Sunday Day shift, 17:30 |
  | **HQ did not handle** | Night shift escalates; Day shift will reassign to HQ. | Yes — User → HQ, next Day shift, 17:30 |
  | **Escalate to Core Team** | Night shift escalates; Day shift will reassign to Core Team. | Yes — User → Core Team, next Day shift, 09:00 |
  | **Case Closed** | CC has already closed the case; this tag asks the next shift's handover note to explicitly acknowledge the closure so nothing slips through. | No |
  | **Escalated to HQ please keep an eye on this** | Already at HQ; operator is watching. | No |
  | **Need to contact user** | Operator wants user contacted before next move. | No |
  | **Sanity Check** | Operator wants the case routed through the sanity-check stage. | No |

- **Scheduled handoff rules** (the first three statuses). On each picked case with one of these track statuses, compute a `scheduledHandoff = { from, to, dueAt, dueShift }`:
  - *Weekend Case* — every Fri/Sat shift passes the case via handover note; the **Sunday Day shift** is the one that performs the reassignment at **17:30**, from current assignee (typically *User*) to **HQ**.
  - *HQ did not handle* — Night shift passes via handover; the next **Day shift** performs the reassignment at **17:30**, User → HQ.
  - *Escalate to Core Team* — Night shift passes via handover; the next **Day shift** performs the reassignment at **09:00**, User → Core Team.
  - Computed against the existing rota (`window.ROTA`) and `window.NOW`; reuse the shift-resolution helpers already in `app.js`.
- Setting Track Status happens through a **simple 7-item picker** on the case detail panel (right pane of the new bottom zone). The old CC-shaped status-transition dropdown and its per-status action buttons (assign to Core, escalate to HQ, chase owner, verify fix, return to requester, move to sanity check, close, cancel, reopen) are **removed**. The picker lists the 7 Track Status names in their canonical wording; the ones typically set by the current shift (*Escalate to Core Team* and *HQ did not handle* on Night; *Weekend Case* on Fri/Sat shifts; the remaining four on Day) carry a small "Suggested for your shift" hint pill — but every value is one click away regardless of shift.
- **Track Status persists.** It never auto-clears — even after CC catches up to the desired routing or status. The operator must clear it manually via **Clear Track Status** on the detail panel. The clear action checks two pre-conditions and surfaces a soft confirmation if either is unmet (the operator can still proceed):
  - **Work is done** — interpretation depends on the Track Status:
    - *Weekend Case / HQ did not handle / Escalate to Core Team* → CC `assignee` (resolved via the dept→role mapping) now matches the Route Board's *To* chip.
    - *Case Closed* → CC `status` is `closed` or `cancelled`.
    - *Escalated to HQ — keep an eye / Need to contact user / Sanity Check* → no machine check; operator judgment.
  - **Passed to the next shift** — a fresh handover note exists targeting the incoming shift.
- Watchlists: keep the existing **Approaching SLA (N)** and **Stale handover (N)** banners; replace today's "Escalated — keep an eye" banner with two new ones: — ✅ **done** (mechanism: `renderWatchlists` is fed `actionDueCases().concat(actionOverdueCases())` at line ~1667; note: the second section's header text still literally reads "Escalated — keep an eye" at line ~1224 — cosmetic relabel outstanding)
  - **Action due this shift (N)** — picked cases whose `scheduledHandoff.dueShift` matches the current operator's shift. — ✅ **done** (`actionDueCases`)
  - **Action overdue (N)** — `dueAt` is in the past and CC still shows the old assignee. — ✅ **done** (`actionOverdueCases`)
- This and the route-board (section 6) are the only new state shapes; everything else reuses existing operator-layer machinery.

Critical files: `frontend/app.js` (the 7-item Track Status picker on the detail panel, the watchlist banners, `agent-v1` (un)packing for `trackStatus`, the shift-aware scheduled-handoff computation).

### 4. Remove CC-shaped actions; the only operator mutation is Track Status — ✅ **done** (`renderDetailActions` exposes only the Track Status picker + Clear + helper affordances; no CC-shaped action surface renders; `flags[]` is gone from the model. Caveat: `derivePromptsForCase`/`PROMPT_DEFS` and their `assign_core`/`escalate_to_hq`/`chase_*`/`verify_fix` handlers (lines ~3919-4005) still exist as unreferenced dead code — never wired to any rendered button)

The existing CC-shaped action surface (status-transition dropdown, per-status buttons like *Assign to Core*, *Escalate to HQ*, *Chase owner*, *Verify fix*, *Return to requester*, *Move to sanity check*, *Close*, *Cancel*, *Reopen*) is **removed** — operators do all that work in Case Center. The only operator-driven mutation on a picked case is **Track Status** (via the 7-item picker, section 3).

- **Drop** the kanban-by-CC-status grouping, the drag-between-columns handler, and any `validTransitions` / state-machine guards that gated those actions.
- **Drop** the handlers that mutated `status`, `coreId`, `hqId`, `currentOwner`, `holdMs`, `holdStartedAt`, `slaPaused`, `slaAccumulatedMs`, or pushed CC-shaped events into `history[]`. CC-owned fields are display-only everywhere in the SPA.
- **Drop the `flags[]` array entirely** from the case model. The only operator-set field on a picked case is now `trackStatus` (single value). Remove flag rendering from cards, lanes, detail panel, and watchlist filters; remove any flag-setting code paths.
- **History entries** for operator-intent changes are kept, but only one shape now: `{ kind: 'track-status-set', from, to, who, at }`. They live in the operator layer alongside handover/reminder and never get sent to Case Center.
- **`+ New case` stays.** It's the manual-import affordance for older cases that aren't in the recent look-back window — the operator types a Case Center ID and the existing `addCaseById` flow pulls that single case (`fetch_raw` honours `CASE_ID` already, per `docs/SETUP.md`). The imported case lands in the Archive Overview at the week of its `createdAt` and can be picked from there.
- **Status flow** page (`#/flow`) and **Clock model** page (`#/clocks`) — keep as read-only reference docs.

The case detail panel keeps the full read-only display of CC-owned fields (subject, priority, user/dept, CC status label, process timeline, wait-user detail, ownership timeline, SLA / hold clocks). Per-case affordances on the detail panel: **Track Status picker (7 options)**, **Clear Track Status** (with preconditions, section 3), **Pick / Unpick**, **Handover note**, **Set reminder**, **[Open in Case Center]** (the existing `caseLink`, prominent when the case is action-due / overdue).

### 5. Auto-refresh toggle for picked cases — ⬜ **open** (not implemented: no Auto-refresh toolbar toggle / interval picker / "Last refreshed" state, and neither `local/serve.py` nor `backend/api.py` accepts `?ids=` for scoped refresh — they support single `id=` only. A per-case manual ⟳ `refresh-case` button exists, but the auto-refresh loop is still pending)

The operator needs the Case Center state on picked cases to stay reasonably fresh so the Route Board's "current assignee" and the action-due / overdue highlight track reality.

- Add a small **Auto-refresh** control in the Picked workspace toolbar (above the Route Board strip, or in the sidebar near the operator switcher) with:
  - On/Off toggle (default **Off**; remembered in localStorage as `case-tracker-autorefresh`).
  - Interval picker: **5 / 10 / 15 / 30 / 60 minutes** (remembered as `case-tracker-autorefresh-min`).
  - Inline state next to it: "Last refreshed Xm ago" + a manual **Refresh now** button.
- Implementation: a single `setInterval` started/cleared by the toggle. On tick, call the existing `tryLoadLiveCases()` path but **scoped to picked case IDs only** — extend `local/serve.py` `/api/cases` and `backend/api.py` `/api/cases` to accept an `?ids=…` query that filters the response (the ingestion layer already supports per-case fetch via `CASE_ID`, so this fits the existing shape). When no `?ids=` is supplied, behavior is unchanged.
- The merge path is the existing `CC_OWNED_FIELDS` overlay — picks, handovers, reminders, and `trackStatus` are preserved. After each refresh, the Action-due / Action-overdue watchlists re-count automatically.
- If the operator is offline or `API_BASE` is empty, the toggle is shown but disabled with a tooltip ("Live mode not configured").
- No polling in seed-only mode — the demo `data.js` is frozen.

Critical files: `frontend/app.js` (toolbar control, interval loop, scoped refresh call), `local/serve.py` (accept `?ids=`), `backend/api.py` (accept `?ids=`).

### 6. Aggregate Route Board — three stations, one row per picked case — ✅ **done** (`renderRouteBoardStrip`: three stations User·Core Team·HQ, per-case lanes, dot from `assigneeDept`→`route_role`, arrow/travelling-dot/eyeball per Track Status, Sanity Check collapsible group, action-due/overdue amber/red. Caveat: the detail-panel single-case "Next stop" mirror bullet below is not implemented)

The top zone of the Picked workspace is a clean visualisation with minimal text: three station columns and one row per picked case.

- **Stations (column headers):** *User · Core Team · HQ*. Always exactly three; no more, no fewer.
- **Per-case row.** Each picked case is a horizontal lane spanning all three stations. The visual elements:
  - **Dot at the current station** — derived from CC `assigneeDept` via the dept→role mapping in `owners.js`. Each Core Team desk and HQ Product Team row carries a `route_role` field (one of `Core Team` / `HQ` / `User`); anything unmapped falls back to *User* with a small "unmapped" hint so the team adds it. *Exception:* Track Statuses **Case Closed** and **Sanity Check** pin the dot to *User* regardless of `assigneeDept` (the operator's intent for these is "back at the user, awaiting closure / sanity-check sign-off").
  - **Arrow + animated travelling dot** — drawn when Track Status implies a scheduled move (see table below). The small dot loops along the arrow at a slow pace (~2-second cycle) to signal "this case is in flight to its next stop".
  - **Eyeball icon on a station** — drawn for the "watching" Track Statuses (see table below).
  - **Right-edge label** — case ID + short subject + due-time chip (e.g. *Sun 17:30* or *09:00*, amber when due this shift, red when overdue).
- **Track Status → visual rules:**

  | Track Status | Arrow | Eyeball | Notes |
  | --- | --- | --- | --- |
  | *Weekend Case* | User → HQ (with travelling dot) | — | Due Sunday Day shift, 17:30 |
  | *HQ did not handle* | User → HQ (with travelling dot) | — | Due next Day shift, 17:30 |
  | *Escalate to Core Team* | User → Core Team (with travelling dot) | — | Due next Day shift, 09:00 |
  | *Escalated to HQ — keep an eye* | Current → HQ (animated, only if dot not already at HQ) | On HQ | Watching at HQ; arrow disappears once the dot lands at HQ |
  | *Need to contact user* | Current → User (animated, only if dot not already at User) | On User | Watching at User; arrow disappears once the dot lands at User |
  | *Case Closed* | — | — | Dot pinned to **User** (regardless of CC `assigneeDept`); small "✓ closed" badge next to the dot |
  | *Sanity Check* | — | — | Dot pinned to **User** (yet to be closed); case subject rendered as the tag next to the dot |
  | *(none)* | — | — | Just the dot at the current station |

- **Mismatch surfacing.** When the Track Status implies an arrow but the current dot is not at the *From* station (e.g. *Weekend Case* but CC `assigneeDept` resolves to HQ already), the lane shows a soft warning marker so the operator notices the picture doesn't match the intent. When the dot has reached the *To* station (arrow's destination), the arrow fades and a "✓ delivered" marker appears at the destination — the Track Status pill is still there, awaiting manual clear (section 3).
- **Sanity Check group.** *Sanity Check* tends to be the largest Track Status bucket; render those lanes in a collapsible group pinned to the **bottom** of the strip with a header *"Sanity Check (N) ▸"* (collapsed by default). Expanding shows the individual lanes; collapsing hides them so the urgent lanes above stay glanceable. Selection still works inside the expanded group.
- **Strip scroll.** Above the Sanity Check group, lanes scroll vertically inside the strip's 1/3-height zone when they overflow; the bottom list + detail zone stays fixed.
- **Selection.** Clicking a lane selects that case (loads it into the detail panel below; highlights the matching row in the list). Selection is global to the page.
- **Detail panel mirror.** The right pane (case detail) also renders a single-case version of this Route Board at the top of the detail content, with a "Next stop" label and the *From / To / Time / Owning shift* spelled out in words for clarity. — ⬜ **open** (no `renderRouteBoardSingle` / "Next stop" mirror in the detail pane today; `renderReadingPanel` shows the Track Status pill but not the spelled-out single-case board)
- **Computation.** Pure function of `(trackStatus, assigneeDept, now, ROTA, OWNERS)`. No new persisted state — `scheduledHandoff = { from, to, dueAt, dueShift }` is derived on the fly each render. Reuse existing rota / shift helpers so the "next Day shift at 17:30" lookup honours the actual schedule.
- **Zero-dependency.** Stations + dots + arrows + animation are CSS / SVG inline; no chart library.

Critical files: `frontend/app.js` (`renderRouteBoardStrip` for the aggregate view, single-case version inside the detail panel, scheduled-handoff computation, dept→role lookup), `frontend/owners.js` (per-dept `route_role` field surfaced as a small dropdown in the Owners editor), `frontend/styles.css` (stations grid, dot, arrow, travelling-dot animation, eyeball, amber/red action-due treatment).

### 7. Analytics: split picked vs unpicked + time-on-us trend — ⬜ **open** (not implemented: `weekStats` returns single un-split totals; `renderArchiveIndex`/`renderArchiveWeek` show one stat row with no Picked-vs-Unpicked split and no time-on-us histogram)

Augment the existing `weekStats` function and its renderers in `frontend/app.js`:

- For each week card (`renderArchiveIndex`), show two parallel mini-stat rows: **Picked** (count, open/closed/cancelled, median time-on-us) and **Unpicked** (same metrics). This makes "did picking help?" visible at a glance.
- On the week-detail page (`renderArchiveWeek`):
  - Summary bar splits into a **Picked** column and an **Unpicked** column with the same metrics already computed today, plus an **Approaching SLA** count.
  - Add a simple **time-on-us histogram** (CSS-only bar buckets: 0–4h, 4–12h, 12–24h, 1–3d, 3d+) stacked picked vs unpicked. The data is already in `slaAccumulatedMs`; no new computation library is needed.
- No charting dependency — keep it CSS bars to stay zero-dependency per repo convention.

### 8. Keep operator-helper features intact — ✅ **done** (handover notes + reminders retained on detail panel; `#/shifts` + `#/owners` intact; each Core/HQ row in `owners.js` carries a `route_role` of `Core Team`/`HQ`/`User`)

- **Handover notes** and **reminders** — keep as-is on the case detail panel; both are operator-layer state already.
- **Shifts + rota editor** (`#/shifts`) — unchanged.
- **Owners editor** (`#/owners`) — keep, and reframe as a **contact reference + dept→role mapping**. Each Core Team desk and HQ Product Team row gains a `route_role` field (one of `Core Team` / `HQ` / `User`) used by the Route Board's From-chip derivation (section 6). Remove any "assign this case to desk X" action that lives here; the editor itself stays.

### 9. Wording / branding pass — ✅ **done** (sidebar nav reads **Picked** / **Overview** in `index.html`; card buttons say Pick/Picked; `tour.js` rewritten for the Picked-workspace + Route Board flow. Minor residue: `renderArchiveIndex` H1 still reads "Weekly Archive" rather than "Overview")

- Sidebar nav: rename **Board → Picked** (or **My Picks**), **Archive → Overview**. Empty-state copy on Picked should tell a new operator: "Open Overview to find cases to pick — they'll show up here."
- Drop the language of "queue" from card buttons, banners, watchlists.
- Update `frontend/index.html` and `frontend/standalone.html` titles/headers to match.

### 10. Release-note + bundle ritual (per `CLAUDE.md`) — _recurring process item, applied per change as the reframe shipped_

- Add a single dated entry under **Changed** in `docs/RELEASE_NOTES.md` summarizing the reframe (overview/picked/analytics + removed CC-duplicating actions).
- Run `node frontend/bundle.mjs` to regenerate `standalone.html`. The PostToolUse hook does this automatically on edit, but verify before commit.
- ~~Develop on branch `claude/vigilant-knuth-slap60`.~~ — _unapplicable: that specific branch name is from the original plan run; the reframe has since landed on other branches_

## Files to modify (most of the work concentrates here)

- `frontend/app.js` — rewrite `renderCasesView` for the two-zone layout (aggregate Route Board strip on top, list + detail split 1:2 below). Add `renderRouteBoardStrip` (aggregate) and `renderRouteBoardSingle` (detail mirror). Add 7-item Track Status picker + Clear with preconditions. Delete the CC-shaped action handlers, drag-between-columns, two-band split, and validTransitions / state-machine guards. Add scheduled-handoff computation and dept→role lookup. Add archive renderers' picked-vs-unpicked split, `weekStats`. Auto-refresh toolbar + interval loop. `agent-v1` (un)packing for `trackStatus`. `+ New case` stays.
- `local/serve.py`, `backend/api.py` — accept `?ids=` on `GET /api/cases` for scoped refresh of picked cases. — ⬜ **open** (only single `id=` is accepted today; `?ids=` multi-case scope is part of the still-open section 5)
- `frontend/index.html` — sidebar nav labels, page title.
- `frontend/styles.css` — Picked workspace two-zone grid (top strip / bottom 1:2 split). Three-station Route Board styling (stations, dot, arrow, travelling-dot keyframe animation, eyeball, amber / red action-due treatment, ✓ delivered marker). Track Status pill colours. Histogram bars, picked-vs-unpicked split rows.
- `frontend/tour.js` — refresh the product tour steps so they describe the new flow ("browse Overview → Pick → analyze in Picked view").
- `docs/RELEASE_NOTES.md` — one entry under today.
- `frontend/standalone.html` — regenerated by `node frontend/bundle.mjs`.

- `frontend/owners.js` — add a `route_role` field (`Core Team` / `HQ` / `User`) on each Core Team desk and HQ Product Team row; surface it as a small dropdown in the Owners editor.

No changes to `data.js`, `shifts.js`. The only backend tweak is the `?ids=` query support for scoped refresh.

## Verification

1. `node frontend/tests/run.cjs` — must pass (Stop hook also runs this). Update any tests that asserted on removed actions (status transitions, create case) to reflect the new behavior.
2. `cd prototype && python3 -m http.server 8000` and walk through:
   - Land on `#/cases` (Picked) by default; if you have no picks yet, the empty-state copy directs you to **Overview**. No CC status columns appear anywhere — confirm the old kanban grid is gone.
   - Open `#/archive`; see the week index with picked-vs-unpicked split stats. Open a week; verify the table lists every CC case with a Pick button; pick 3 cases.
   - Return to `#/cases`. The page is split into two zones: aggregate **Route Board** strip on top (1/3 height), and **list + detail** below (2/3 height, 1:2 width). Three station columns at the top: *User · Core Team · HQ*. Each picked case is one lane in the strip, with a dot at its current station (derived from CC `assigneeDept`).
   - Select the first case (click its lane or its list row) — the detail panel on the right populates. On the detail panel, use the **7-item Track Status picker** to set Track Status = **Weekend Case**. The case's lane in the top strip gains an arrow from User to HQ with a slow-looping travelling dot; the right-edge label shows *Sun 17:30*.
   - Set the second case's Track Status = **Escalate to Core Team**. Its lane shows User → Core Team with the travelling dot and right-edge label *Day shift 09:00*.
   - Set the third case's Track Status = **Escalated to HQ — keep an eye**. If the dot is already at HQ, only the **eyeball icon** appears on the HQ station, no arrow. If the dot is at User or Core Team, an animated arrow points from the current station to HQ, plus the eyeball at HQ.
   - Set a fourth case's Track Status = **Case Closed**. Lane shows the dot pinned to **User** (even if CC `assigneeDept` maps to HQ or Core Team) with a **✓ closed badge** next to it; no arrow.
   - Pick several more cases and set their Track Status to **Sanity Check**. Each lane has the dot pinned to **User** with the **case subject** rendered as the tag next to the dot. Confirm they collapse into a single *"Sanity Check (N) ▸"* row pinned to the bottom of the strip (collapsed by default). Click the toggle to expand and confirm each individual lane renders; collapse again.
   - Advance `window.NOW` (or wait into the relevant shift) so a scheduled handoff falls within the current shift — the arrow turns amber, the lane's right-edge time chip turns amber, and the **Action due this shift (N)** watchlist increments. With `window.NOW` past `dueAt` while CC `assignee` still equals the *From* station, the arrow turns red and the case lands in **Action overdue (N)**.
   - Confirm CC-owned fields on the detail panel render but are not editable. There is **no CC-shaped action dropdown / button** — only the Track Status picker and the operator-helper affordances. The `+ New case` button is still present; type an older Case Center ID and verify the manual-import flow brings that one case into the archive overview at the week of its `createdAt`.
   - Add a handover note and a reminder — both persist.
   - Turn on the **Auto-refresh** toggle at 5 minutes; verify the picked-case scoped refresh fires (or trigger it via **Refresh now**), CC current-assignee / status updates if they changed in Case Center, and `trackStatus` / picks / handovers / reminders survive the merge. When the CC `assignee` reaches the lane's *To* station, the arrow fades and a **✓ delivered** marker appears at the destination — the Track Status pill stays until manually cleared.
   - Manually clear Track Status on a delivered case via **Clear Track Status** on the detail panel. The lane collapses back to a single dot at the current station. Per the team rule, only clear once the **work is done** *and* the **handover note for the next shift** is written; the Clear action surfaces a soft confirmation when either pre-condition isn't met (for *Case Closed*: CC status is closed/cancelled; for the scheduled types: CC assignee matches the route's *To* station; others: operator judgment).
   - Refresh the page; picks, handover, reminder survive (operator layer in localStorage).
   - Switch operator via the sidebar; confirm picked state behaves as expected for the chosen operator model (today picks are global per the existing implementation — call out in the release note if we keep that vs make picks per-operator).
3. Reopen `frontend/standalone.html` via `file://` after `node frontend/bundle.mjs`; the same walkthrough should work without a server.
4. With `local/serve.py` running and `local/casecenter.py` wired to a real account, run a live refresh and confirm picks/handovers/reminders survive the merge (the existing `CC_OWNED_FIELDS` overlay already guarantees this — verify, don't re-engineer).
