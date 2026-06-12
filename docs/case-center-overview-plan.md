# Plan: Make the SPA a read-only Case Center overview + pick-for-follow-up + analytics

## Context

Today the SPA looks like a parallel case-management tool: operators can change status, route to Core/HQ desks, escalate, chase owners, verify fixes, create new cases, etc. In reality, operators do all of that work in **Case Center** — re-doing it here is double bookkeeping with no payoff. The reason the platform exists is to add value *on top of* Case Center: surface cases that need more attention, let operators *pick* those for follow-up, and analyze the picked subset.

Reframing per the user:

- **Archive** (`#/archive`) is the full Case Center overview, browsable by week — read-only, where operators go to **pick** new cases for follow-up.
- **Kanban** (`#/cases`) stays the home route. Each shift's operator lands here first because they need to see what the previous shift handed over. It renders only **picked** cases.
- **Every picked case carries two statuses: the *CC status* from Case Center and a *Track Status* set by the operator.** Track Status is a small fixed list (Weekend Case, HQ did not handle, Escalate to Core Team, Case Closed, Escalated to HQ please keep an eye on this, Need to contact user, Sanity Check). The first three have **scheduled handoff rules** telling the next shift's 1st-line operator when to reassign the case in Case Center (from the current assignee to a specific desired assignee). This is the platform's core value-add — it captures the operator's intent, which Case Center has no place to record.
- A **Route Board** on each picked case visualises the next stop. Normally the case sits at *User*; when the track status is e.g. *Weekend Case*, an arrow goes to *HQ* with the scheduled time (e.g. *Sunday 17:30*).
- **Existing action buttons stay** (assign to Core, escalate to HQ, chase owner, verify fix, return to requester, move to sanity check, etc.) — they are how the operator *sets and changes Track Status* on a picked case. They no longer mutate Case Center fields.
- **Analytics** live in the archive view, splitting picked vs unpicked + time-on-us/SLA trends.
- **Keep** the operator-helper features that don't exist in Case Center: handover notes, reminders, shift/rota editor, owners editor (as a contact/TZ reference).
- **`+ New case` stays** as the manual-import affordance for older Case Center cases that fall outside the look-back window (it pulls a single case by ID; it never creates a case in Case Center).

Read-only is already supported end-to-end: `local/serve.py`, `local/casecenter.py`, `backend/ingest.py`, and `backend/api.py` have no write-back path to Case Center, and the existing `CC_OWNED_FIELDS` overlay protects the operator layer on refresh — no plumbing changes are needed in the ingest/backend tier.

## Recommended approach

### 1. Reframe Archive and Kanban — kanban stays as home

- **`#/cases` (kanban) stays the default landing route.** Each shift's operator opens the app to see what was handed over; landing on the picked workspace is the right first view.
- Kanban renders only `agentStatus === 'queued'` cases. Drop the bottom "backlog/unpicked" band entirely. **Columns are still driven by the CC `status` field** so the operator's mental map matches Case Center. Empty columns get a soft "no picked cases here" placeholder.
- Cards display the Track Status as a coloured pill in the card header, and a tiny **Route Board** strip on the card footer showing *current assignee → next assignee · scheduled time* (see section 6). Cards whose scheduled handoff time is within the current shift (action due) or already past (action overdue) are visibly **highlighted** in place with **[Open in Case Center]** and **[Handover]** affordances. The Action-due watchlist counts these.
- **`#/archive` becomes the full Case Center overview.** The week index (W21…current) and week-detail view stay — they already enumerate every case Case Center has surfaced. This is where the operator goes to find new cases to pick.
- Sidebar nav surfaces both clearly: **Picked** (kanban) on top, **Overview** (archive) just below.

Critical files: `prototype/app.js` (`renderCasesView`, `renderArchiveIndex`, `renderArchiveWeek`, the sidebar nav block).

### 2. Make picking the central interaction

- Reuse the existing `agentStatus: 'queued' | 'unqueued'` flag and `toggleQueue` (in `app.js`) as the pick mechanism — no new field. Rename UI affordances from "Queue / Queued" to **"Pick / Picked"** so the operator-facing language matches the user's mental model.
- Add a `[Pick] / [Picked ✓]` button to every card in the archive week-detail table (`renderArchiveWeek`). Clicking pick is the *only* card-level mutation in archive view.
- On the kanban, the toggle becomes "Unpick" (sends the case back to the archive overview).
- Picked state persists via the existing operator layer (`agent-v1` localStorage key + `POST /api/save`). No backend schema change.

Critical files: `prototype/app.js` (`toggleQueue`, `renderCard`, the archive table renderer).

### 3. Track Status — the operator's intent on each picked case (the core value-add)

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
- Setting Track Status happens through the **existing action surface** — the status-transition dropdown and the per-status action buttons (assign to Core, escalate to HQ, verify fix, move to sanity check, etc.) all stay; they now write `trackStatus` instead of CC fields. The dropdown lists **all 7** Track Statuses to every shift in a single uniform list — no gating. Options the current shift typically uses (*Escalate to Core Team* and *HQ did not handle* on Night; *Weekend Case* on Fri/Sat shifts; the remaining four on Day) carry a small "Suggested for your shift" pill beside them as a hint; the operator can still pick any of the 7 with no extra click.
- **Track Status persists.** It never auto-clears — even after CC catches up to the desired routing or status. The operator must clear it manually via **Clear Track Status** on the detail panel. The clear action checks two pre-conditions and surfaces a soft confirmation if either is unmet (the operator can still proceed):
  - **Work is done** — interpretation depends on the Track Status:
    - *Weekend Case / HQ did not handle / Escalate to Core Team* → CC `assignee` (resolved via the dept→role mapping) now matches the Route Board's *To* chip.
    - *Case Closed* → CC `status` is `closed` or `cancelled`.
    - *Escalated to HQ — keep an eye / Need to contact user / Sanity Check* → no machine check; operator judgment.
  - **Passed to the next shift** — a fresh handover note exists targeting the incoming shift.
- Watchlists: keep the existing **Approaching SLA (N)** and **Stale handover (N)** banners; replace today's "Escalated — keep an eye" banner with two new ones:
  - **Action due this shift (N)** — picked cases whose `scheduledHandoff.dueShift` matches the current operator's shift.
  - **Action overdue (N)** — `dueAt` is in the past and CC still shows the old assignee.
- This and the route-board (section 6) are the only new state shapes; everything else reuses existing operator-layer machinery.

Critical files: `prototype/app.js` (the dropdown action handlers that now write `trackStatus`, the card renderer for the pill + highlight, the detail panel form, the watchlist banners, `agent-v1` (un)packing, the shift-aware scheduled-handoff computation).

### 4. Rewire existing actions to set *Track Status* (don't remove them)

The action surface stays — those buttons and dropdowns are how the operator expresses intent. What changes is what they mutate:

- **Status-transition dropdown** and **per-status action buttons** (assign to Core, escalate to HQ, chase owner, verify fix, return to requester, move to sanity check, close, cancel, reopen, etc.) now write `trackStatus` on the operator layer **only**. The dropdown surfaces all 7 Track Statuses to every shift, with the current-shift-relevant ones highlighted on top (see section 3); they no longer touch `status`, `coreId`, `hqId`, `currentOwner`, `holdMs`, `holdStartedAt`, `slaPaused`, `slaAccumulatedMs`, or push CC-shaped events into `history[]`. CC-owned fields are display-only.
- **Routing is not rigid.** Drop any state-machine guard that restricts which statuses an operator can pick (e.g. "can only escalate from with_core to with_hq"). Every Track Status is selectable from anywhere. If `validTransitions` / similar helpers exist in `app.js`, replace their call sites with the full track-status enum.
- **Drag-between-columns** on the kanban is removed — cards stay in their CC `status` column. The way to set Track Status is the dropdown / action button.
- **History entries** for these actions are kept, but tagged as operator-intent events (e.g. `kind: 'track-status-set'`, with `from`, `to`, `who`, `at`). They live in the operator layer alongside handover/reminder and never get sent to Case Center.
- **`+ New case` stays.** It's the manual-import affordance for older cases that aren't in the recent look-back window — the operator types a Case Center ID and the existing `addCaseById` flow pulls that single case (`fetch_raw` honours `CASE_ID` already, per `docs/SETUP.md`). After import, the case appears in the archive overview and can be picked.
- **Status flow** page (`#/flow`) and **Clock model** page (`#/clocks`) — keep as read-only reference docs.

The case detail panel keeps the full read-only display of CC-owned fields (subject, priority, user/dept, CC status label, process timeline, wait-user detail, ownership timeline, SLA/hold clocks). Operators *see* CC state; they can't change it from here.

Card actions on the kanban: existing action set, retargeted to Track Status, plus **Pick / Unpick**, **Handover note**, **Set reminder**, and an **[Open in Case Center]** affordance (existing `caseLink`) that becomes prominent on any action-due card.

### 5. Auto-refresh toggle for picked cases

The operator needs the Case Center state on picked cases to stay reasonably fresh so the Route Board's "current assignee" and the action-due / overdue highlight track reality.

- Add a small **Auto-refresh** control in the kanban toolbar (or the sidebar near the operator switcher) with:
  - On/Off toggle (default **Off**; remembered in localStorage as `case-tracker-autorefresh`).
  - Interval picker: **5 / 10 / 15 / 30 / 60 minutes** (remembered as `case-tracker-autorefresh-min`).
  - Inline state next to it: "Last refreshed Xm ago" + a manual **Refresh now** button.
- Implementation: a single `setInterval` started/cleared by the toggle. On tick, call the existing `tryLoadLiveCases()` path but **scoped to picked case IDs only** — extend `local/serve.py` `/api/cases` and `backend/api.py` `/api/cases` to accept an `?ids=…` query that filters the response (the ingestion layer already supports per-case fetch via `CASE_ID`, so this fits the existing shape). When no `?ids=` is supplied, behavior is unchanged.
- The merge path is the existing `CC_OWNED_FIELDS` overlay — picks, handovers, reminders, and `trackStatus` are preserved. After each refresh, the Action-due / Action-overdue watchlists re-count automatically.
- If the operator is offline or `API_BASE` is empty, the toggle is shown but disabled with a tooltip ("Live mode not configured").
- No polling in seed-only mode — the demo `data.js` is frozen.

Critical files: `prototype/app.js` (toolbar control, interval loop, scoped refresh call), `local/serve.py` (accept `?ids=`), `backend/api.py` (accept `?ids=`).

### 6. Route Board — visualise the next stop

On every picked case, render a small **Route Board** that shows where the case currently sits and where (if anywhere) it is planned to go next.

- **Default state (no Track Status, or a non-scheduled one):** a single chip — `User` — meaning the case is sitting with the requester and the operator has no pending hand-off. For non-scheduled track statuses (Case Closed, Escalated to HQ — keep an eye, Need to contact user, Sanity Check) the route board shows the current assignee chip plus a small tag of the track status; no arrow.
- **Scheduled state (Weekend Case · HQ did not handle · Escalate to Core Team):** two chips joined by an arrow — `From → To` — with the scheduled time underneath the arrow.
  - *Weekend Case* → `User ──▶ HQ` · *Sunday 17:30*
  - *HQ did not handle* → `User ──▶ HQ` · *Day shift, 17:30*
  - *Escalate to Core Team* → `User ──▶ Core Team` · *Day shift, 09:00*
  - When the dueAt falls within the current shift → arrow turns amber ("action due").
  - When `now > dueAt` and the CC `assignee` still equals the *From* chip → arrow turns red ("action overdue").
- **Where it renders:**
  - **Kanban card footer** — single-line compact form: chip → chip · time.
  - **Case detail panel** — full-width version with the same chips but also a label above ("Next stop") and the *From / To / Time / Owning shift* spelled out.
- **Chip derivation.** The **From** chip is derived from the live CC `assigneeDept` field via a dept→role mapping kept in `prototype/owners.js` (each Core Team desk and HQ Product Team row carries an explicit `route_role` of `Core Team` or `HQ`; anything else → `User`). The mapping is editable in the existing Owners editor (`#/owners`) — see section 8. The **To** chip is the abstract destination implied by Track Status (*User*, *Core Team*, or *HQ*). If the From chip can't be resolved (dept not in mapping), fall back to the literal CC assignee name and surface a small "unmapped" hint so the team adds it to `owners.js`.
- **Computation:** pure function of `(trackStatus, assigneeDept, now, ROTA, OWNERS)`. No new persisted state — `scheduledHandoff` is derived on the fly each render. Reuse existing rota/shift helpers so the "next Day shift at 17:30" lookup honours the operator's actual schedule.
- Zero-dependency: chips + CSS arrow, no SVG library needed.

Critical files: `prototype/app.js` (route-board renderer, scheduled-handoff computation, dept→role lookup), `prototype/owners.js` (per-dept `route_role` field), `prototype/styles.css` (chip + arrow styling).

### 7. Analytics: split picked vs unpicked + time-on-us trend

Augment the existing `weekStats` function and its renderers in `prototype/app.js`:

- For each week card (`renderArchiveIndex`), show two parallel mini-stat rows: **Picked** (count, open/closed/cancelled, median time-on-us) and **Unpicked** (same metrics). This makes "did picking help?" visible at a glance.
- On the week-detail page (`renderArchiveWeek`):
  - Summary bar splits into a **Picked** column and an **Unpicked** column with the same metrics already computed today, plus an **Approaching SLA** count.
  - Add a simple **time-on-us histogram** (CSS-only bar buckets: 0–4h, 4–12h, 12–24h, 1–3d, 3d+) stacked picked vs unpicked. The data is already in `slaAccumulatedMs`; no new computation library is needed.
- No charting dependency — keep it CSS bars to stay zero-dependency per repo convention.

### 8. Keep operator-helper features intact

- **Handover notes** and **reminders** — keep as-is on the case detail panel; both are operator-layer state already.
- **Shifts + rota editor** (`#/shifts`) — unchanged.
- **Owners editor** (`#/owners`) — keep, and reframe as a **contact reference + dept→role mapping**. Each Core Team desk and HQ Product Team row gains a `route_role` field (one of `Core Team` / `HQ` / `User`) used by the Route Board's From-chip derivation (section 6). Remove any "assign this case to desk X" action that lives here; the editor itself stays.

### 9. Wording / branding pass

- Sidebar nav: rename **Board → Picked** (or **My Picks**), **Archive → Overview**. Empty-state copy on Picked should tell a new operator: "Open Overview to find cases to pick — they'll show up here."
- Drop the language of "queue" from card buttons, banners, watchlists.
- Update `prototype/index.html` and `prototype/standalone.html` titles/headers to match.

### 10. Release-note + bundle ritual (per `CLAUDE.md`)

- Add a single dated entry under **Changed** in `docs/RELEASE_NOTES.md` summarizing the reframe (overview/picked/analytics + removed CC-duplicating actions).
- Run `node prototype/bundle.mjs` to regenerate `standalone.html`. The PostToolUse hook does this automatically on edit, but verify before commit.
- Develop on branch `claude/vigilant-knuth-slap60`.

## Files to modify (most of the work concentrates here)

- `prototype/app.js` — card/board renderer (CC `status` columns with Track Status pill + Route Board + action-due highlight), archive renderers, `weekStats`, retarget existing action handlers to write `trackStatus` instead of CC fields, drop transition guards, remove the drag-between-columns handler, scheduled-handoff computation (uses `window.ROTA` + `window.NOW`), auto-refresh toolbar + interval loop, button rewording, `agent-v1` (un)packing for `trackStatus`. `+ New case` stays as the manual single-case import.
- `local/serve.py`, `backend/api.py` — accept `?ids=` on `GET /api/cases` for scoped refresh of picked cases.
- `prototype/index.html` — sidebar nav labels, page title.
- `prototype/styles.css` — Track Status pill colours, Route Board chips + arrow + amber/red action-due treatment, histogram bars, picked-vs-unpicked split rows.
- `prototype/tour.js` — refresh the product tour steps so they describe the new flow ("browse Overview → Pick → analyze in Picked view").
- `docs/RELEASE_NOTES.md` — one entry under today.
- `prototype/standalone.html` — regenerated by `node prototype/bundle.mjs`.

- `prototype/owners.js` — add a `route_role` field (`Core Team` / `HQ` / `User`) on each Core Team desk and HQ Product Team row; surface it as a small dropdown in the Owners editor.

No changes to `data.js`, `shifts.js`. The only backend tweak is the `?ids=` query support for scoped refresh.

## Verification

1. `node prototype/tests/run.cjs` — must pass (Stop hook also runs this). Update any tests that asserted on removed actions (status transitions, create case) to reflect the new behavior.
2. `cd prototype && python3 -m http.server 8000` and walk through:
   - Land on `#/cases` (Picked) by default; if you have no picks yet, the empty-state copy directs you to **Overview**.
   - Open `#/archive`; see the week index with picked-vs-unpicked split stats. Open a week; verify the table lists every CC case with a Pick button; pick 3 cases.
   - Return to `#/cases`; see exactly those 3 cases, grouped by their **CC `status`** column with a neutral "on track" treatment.
   - On one card, set Track Status = **Weekend Case** via the action dropdown. The card **stays in its CC `status` column**, gains a Track Status pill in the header, and the Route Board strip shows `User ──▶ HQ` · *Sunday 17:30*.
   - Set another card to Track Status = **Escalate to Core Team**; Route Board shows `User ──▶ Core Team` · *Day shift 09:00*.
   - Set a third card to Track Status = **Case Closed** (a non-scheduled one); Route Board collapses to a single `User` chip + Track Status tag, no arrow.
   - Advance `window.NOW` (or wait into the relevant shift) so a scheduled handoff falls within the current shift — the Route Board arrow turns amber, the card highlights, and the **Action due this shift (N)** watchlist increments. With `window.NOW` past `dueAt` while CC `assignee` still equals the From chip, the arrow turns red and the card lands in **Action overdue (N)**.
   - Confirm CC-owned fields on the detail panel render but are not editable. The `+ New case` button is still present; type an older Case Center ID and verify the manual-import flow brings that one case into the archive overview.
   - Add a handover note and a reminder — both persist.
   - Turn on the **Auto-refresh** toggle at 5 minutes; verify the picked-case scoped refresh fires (or trigger it via **Refresh now**), CC current-status / assignee updates if they changed in Case Center, and `trackStatus` / picks / handovers / reminders survive the merge. Track Status does **not** auto-clear when CC catches up — the Route Board updates the From chip (so the arrow now goes *To → To*, signalling "delivered"), but the Track Status pill stays until the operator clears it manually (see next step).
   - Manually clear Track Status on a delivered case: open the case detail panel and choose **Clear Track Status**. The route board collapses back to a single chip. Per the team rule, only do this once the **work is done** *and* the relevant **handover note for the next shift** has been written. The Clear action surfaces a soft confirmation when either pre-condition isn't met — for *Case Closed* the check is "CC status is closed/cancelled"; for the scheduled types it is "CC assignee now matches the route's *To* chip"; for the others it's operator judgment.
   - Refresh the page; picks, handover, reminder survive (operator layer in localStorage).
   - Switch operator via the sidebar; confirm picked state behaves as expected for the chosen operator model (today picks are global per the existing implementation — call out in the release note if we keep that vs make picks per-operator).
3. Reopen `prototype/standalone.html` via `file://` after `node prototype/bundle.mjs`; the same walkthrough should work without a server.
4. With `local/serve.py` running and `local/casecenter.py` wired to a real account, run a live refresh and confirm picks/handovers/reminders survive the merge (the existing `CC_OWNED_FIELDS` overlay already guarantees this — verify, don't re-engineer).
