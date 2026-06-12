# Plan: Make the SPA a read-only Case Center overview + pick-for-follow-up + analytics

## Context

Today the SPA looks like a parallel case-management tool: operators can change status, route to Core/HQ desks, escalate, chase owners, verify fixes, create new cases, etc. In reality, operators do all of that work in **Case Center** — re-doing it here is double bookkeeping with no payoff. The reason the platform exists is to add value *on top of* Case Center: surface cases that need more attention, let operators *pick* those for follow-up, and analyze the picked subset.

Reframing per the user:

- **Archive** (`#/archive`) is the full Case Center overview, browsable by week — read-only, where operators go to **pick** new cases for follow-up.
- **Kanban** (`#/cases`) stays the home route. Each shift's operator lands here first because they need to see what the previous shift handed over. It renders only **picked** cases.
- **Every picked case carries two states: a *desired state* set by the operator and a *current state* read from Case Center.** When they don't match, the case is flagged as needing action (do the work in Case Center) or handover (pass the intent to the next shift). This is the platform's core value-add — it captures the operator's intent, which Case Center has no place to record.
- **Existing action buttons stay** (assign to Core, escalate to HQ, chase owner, verify fix, return to requester, move to sanity check, etc.) — they are how the operator *sets and changes desired state*. They no longer mutate Case Center fields, and routing is no longer rigid: the operator can pick any status from anywhere.
- **Analytics** live in the archive view, splitting picked vs unpicked + time-on-us/SLA trends.
- **Keep** the operator-helper features that don't exist in Case Center: handover notes, reminders, shift/rota editor, owners editor (as a contact/TZ reference).
- **`+ New case` stays** as the manual-import affordance for older Case Center cases that fall outside the look-back window (it pulls a single case by ID; it never creates a case in Case Center).

Read-only is already supported end-to-end: `local/serve.py`, `local/casecenter.py`, `backend/ingest.py`, and `backend/api.py` have no write-back path to Case Center, and the existing `CC_OWNED_FIELDS` overlay protects the operator layer on refresh — no plumbing changes are needed in the ingest/backend tier.

## Recommended approach

### 1. Reframe Archive and Kanban — kanban stays as home

- **`#/cases` (kanban) stays the default landing route.** Each shift's operator opens the app to see what was handed over; landing on the picked workspace is the right first view.
- Kanban renders only `agentStatus === 'queued'` cases. Drop the bottom "backlog/unpicked" band entirely. **Columns are still driven by the CC `status` field** so the operator's mental map matches Case Center. Empty columns get a soft "no picked cases here" placeholder.
- Cards where `desiredStatus !== status` are visibly **highlighted** in place (border/badge/header treatment) with a mismatch label like *"Desired: Sanity Check · Current: With HQ"* — they don't move column, they just stand out and surface **[Open in Case Center]** and **[Handover]** affordances. The Mismatched watchlist counts these.
- **`#/archive` becomes the full Case Center overview.** The week index (W21…current) and week-detail view stay — they already enumerate every case Case Center has surfaced. This is where the operator goes to find new cases to pick.
- Sidebar nav surfaces both clearly: **Picked** (kanban) on top, **Overview** (archive) just below.

Critical files: `prototype/app.js` (`renderCasesView`, `renderArchiveIndex`, `renderArchiveWeek`, the sidebar nav block).

### 2. Make picking the central interaction

- Reuse the existing `agentStatus: 'queued' | 'unqueued'` flag and `toggleQueue` (in `app.js`) as the pick mechanism — no new field. Rename UI affordances from "Queue / Queued" to **"Pick / Picked"** so the operator-facing language matches the user's mental model.
- Add a `[Pick] / [Picked ✓]` button to every card in the archive week-detail table (`renderArchiveWeek`). Clicking pick is the *only* card-level mutation in archive view.
- On the kanban, the toggle becomes "Unpick" (sends the case back to the archive overview).
- Picked state persists via the existing operator layer (`agent-v1` localStorage key + `POST /api/save`). No backend schema change.

Critical files: `prototype/app.js` (`toggleQueue`, `renderCard`, the archive table renderer).

### 3. Desired state vs current state (the core value-add)

- Add a single new operator-layer field to each case: **`desiredStatus`** (same enum as CC `status`: `new | with_core | with_hq | sanity_check | returned_to_requester | resolved | closed | cancelled`). Default = current CC status at the moment of picking. Stored in the operator layer (`agent-v1` localStorage + `POST /api/save`), never sent to Case Center.
- Optional companion fields (small, keep the model thin): `desiredOwner` (`core | hq | null`) and `desiredNote` (free text — "what I want next"). Skip if they bloat the UI; `desiredStatus` alone delivers the value.
- Setting desired state happens through the **existing action surface** — the status-transition dropdown and the per-status action buttons (assign to Core, escalate to HQ, verify fix, move to sanity check, etc.) all stay; they now write `desiredStatus` (and `desiredOwner` where relevant) instead of CC fields.
- A mismatch (`desiredStatus !== status`) is treated as a per-card flag, not a column-grouper — the card stays in its CC `status` column and gets a highlight + mismatch label (see section 1).
- Watchlists: keep the existing **Approaching SLA (N)** and **Stale handover (N)** banners; add a new **Mismatched (N)** banner that lists picked cases where desired ≠ current. The mismatched banner replaces today's "Escalated — keep an eye" list.
- This is the only new state shape introduced; everything else reuses existing operator-layer machinery.

Critical files: `prototype/app.js` (the card renderer for the highlight treatment, the dropdown action handlers that now write `desiredStatus`, the detail panel form, the watchlist banners, `agent-v1` (un)packing).

### 4. Rewire existing actions to set *desired state* (don't remove them)

The action surface stays — those buttons and dropdowns are how the operator expresses intent. What changes is what they mutate:

- **Status-transition dropdown** and **per-status action buttons** (assign to Core, escalate to HQ, chase owner, verify fix, return to requester, move to sanity check, close, cancel, reopen, etc.) now write to `desiredStatus` / `desiredOwner` on the operator layer **only**. They no longer touch `status`, `coreId`, `hqId`, `currentOwner`, `holdMs`, `holdStartedAt`, `slaPaused`, `slaAccumulatedMs`, or push CC-shaped events into `history[]`. CC-owned fields are display-only.
- **Routing is not rigid.** Drop any state-machine guard that restricts which statuses an operator can pick (e.g. "can only escalate from with_core to with_hq"). Every status option is selectable as a desired state from anywhere. If `validTransitions` / similar helpers exist in `app.js`, replace their call sites with the full status enum.
- **Drag-between-columns** on the kanban is removed — cards stay in their CC `status` column. The way to express "I want this elsewhere" is the dropdown / action button.
- **History entries** for these actions are kept, but tagged as operator-intent events (e.g. `kind: 'desired-status-set'`, with `from`, `to`, `who`, `at`). They live in the operator layer alongside handover/reminder and never get sent to Case Center.
- **`+ New case` stays.** It's the manual-import affordance for older cases that aren't in the recent look-back window — the operator types a Case Center ID and the existing `addCaseById` flow pulls that single case (`fetch_raw` honours `CASE_ID` already, per `docs/SETUP.md`). After import, the case appears in the archive overview and can be picked.
- **Status flow** page (`#/flow`) and **Clock model** page (`#/clocks`) — keep as read-only reference docs.

The case detail panel keeps the full read-only display of CC-owned fields (subject, priority, user/dept, CC status label, process timeline, wait-user detail, ownership timeline, SLA/hold clocks). Operators *see* CC state; they can't change it from here.

Card actions on the kanban: existing action set, retargeted to desired state, plus **Pick / Unpick**, **Handover note**, **Set reminder**, and an **[Open in Case Center]** affordance (existing `caseLink`) that becomes prominent on any mismatched card.

### 5. Auto-refresh toggle for picked cases

The operator needs the Case Center state on picked cases to stay reasonably fresh so the mismatch flag tracks reality.

- Add a small **Auto-refresh** control in the kanban toolbar (or the sidebar near the operator switcher) with:
  - On/Off toggle (default **Off**; remembered in localStorage as `case-tracker-autorefresh`).
  - Interval picker: **5 / 10 / 15 / 30 / 60 minutes** (remembered as `case-tracker-autorefresh-min`).
  - Inline state next to it: "Last refreshed Xm ago" + a manual **Refresh now** button.
- Implementation: a single `setInterval` started/cleared by the toggle. On tick, call the existing `tryLoadLiveCases()` path but **scoped to picked case IDs only** — extend `local/serve.py` `/api/cases` and `backend/api.py` `/api/cases` to accept an `?ids=…` query that filters the response (the ingestion layer already supports per-case fetch via `CASE_ID`, so this fits the existing shape). When no `?ids=` is supplied, behavior is unchanged.
- The merge path is the existing `CC_OWNED_FIELDS` overlay — picks, handovers, reminders, and `desiredStatus` are preserved. After each refresh, the Mismatched watchlist re-counts automatically.
- If the operator is offline or `API_BASE` is empty, the toggle is shown but disabled with a tooltip ("Live mode not configured").
- No polling in seed-only mode — the demo `data.js` is frozen.

Critical files: `prototype/app.js` (toolbar control, interval loop, scoped refresh call), `local/serve.py` (accept `?ids=`), `backend/api.py` (accept `?ids=`).

### 6. Analytics: split picked vs unpicked + time-on-us trend

Augment the existing `weekStats` function and its renderers in `prototype/app.js`:

- For each week card (`renderArchiveIndex`), show two parallel mini-stat rows: **Picked** (count, open/closed/cancelled, median time-on-us) and **Unpicked** (same metrics). This makes "did picking help?" visible at a glance.
- On the week-detail page (`renderArchiveWeek`):
  - Summary bar splits into a **Picked** column and an **Unpicked** column with the same metrics already computed today, plus an **Approaching SLA** count.
  - Add a simple **time-on-us histogram** (CSS-only bar buckets: 0–4h, 4–12h, 12–24h, 1–3d, 3d+) stacked picked vs unpicked. The data is already in `slaAccumulatedMs`; no new computation library is needed.
- No charting dependency — keep it CSS bars to stay zero-dependency per repo convention.

### 7. Keep operator-helper features intact

- **Handover notes** and **reminders** — keep as-is on the case detail panel; both are operator-layer state already.
- **Shifts + rota editor** (`#/shifts`) — unchanged.
- **Owners editor** (`#/owners`) — keep, but reframe as a **contact reference** (team TZ, office hours, Slack/JIRA queue). Remove any "assign this case to desk X" action that lives here; the editor itself stays.

### 8. Wording / branding pass

- Sidebar nav: rename **Board → Picked** (or **My Picks**), **Archive → Overview**. Empty-state copy on Picked should tell a new operator: "Open Overview to find cases to pick — they'll show up here."
- Drop the language of "queue" from card buttons, banners, watchlists.
- Update `prototype/index.html` and `prototype/standalone.html` titles/headers to match.

### 9. Release-note + bundle ritual (per `CLAUDE.md`)

- Add a single dated entry under **Changed** in `docs/RELEASE_NOTES.md` summarizing the reframe (overview/picked/analytics + removed CC-duplicating actions).
- Run `node prototype/bundle.mjs` to regenerate `standalone.html`. The PostToolUse hook does this automatically on edit, but verify before commit.
- Develop on branch `claude/vigilant-knuth-slap60`.

## Files to modify (most of the work concentrates here)

- `prototype/app.js` — card/board renderer (CC `status` columns with mismatch highlight), archive renderers, `weekStats`, retarget existing action handlers to write `desiredStatus`/`desiredOwner` instead of CC fields, drop transition guards, remove the drag-between-columns handler, auto-refresh toolbar + interval loop, button rewording, `agent-v1` (un)packing for the new fields. `+ New case` stays as the manual single-case import.
- `local/serve.py`, `backend/api.py` — accept `?ids=` on `GET /api/cases` for scoped refresh of picked cases.
- `prototype/index.html` — sidebar nav labels, page title.
- `prototype/styles.css` — minor styling for the histogram bars and the picked-vs-unpicked split rows.
- `prototype/tour.js` — refresh the product tour steps so they describe the new flow ("browse Overview → Pick → analyze in Picked view").
- `docs/RELEASE_NOTES.md` — one entry under today.
- `prototype/standalone.html` — regenerated by `node prototype/bundle.mjs`.

No changes to `data.js`, `shifts.js`, `owners.js`. The only backend tweak is the `?ids=` query support for scoped refresh.

## Verification

1. `node prototype/tests/run.cjs` — must pass (Stop hook also runs this). Update any tests that asserted on removed actions (status transitions, create case) to reflect the new behavior.
2. `cd prototype && python3 -m http.server 8000` and walk through:
   - Land on `#/cases` (Picked) by default; if you have no picks yet, the empty-state copy directs you to **Overview**.
   - Open `#/archive`; see the week index with picked-vs-unpicked split stats. Open a week; verify the table lists every CC case with a Pick button; pick 3 cases.
   - Return to `#/cases`; see exactly those 3 cases, grouped by their **CC `status`** column with a neutral "on track" treatment.
   - On one card, change desired status via any of the existing action buttons (e.g. "Escalate to HQ", "Move to sanity check") — including a transition that the old state machine would have blocked. The card **stays in its CC `status` column**, gains a highlight, and shows a mismatch label like *"Desired: Sanity Check · Current: With HQ"* with **[Open in Case Center]** and **[Handover]** buttons. The **Mismatched (N)** watchlist count increments.
   - Confirm CC-owned fields on the detail panel render but are not editable. The `+ New case` button is still present; type an older Case Center ID and verify the manual-import flow brings that one case into the archive overview.
   - Add a handover note and a reminder — both persist.
   - Turn on the **Auto-refresh** toggle at 5 minutes; verify the picked-case scoped refresh fires (or trigger it via **Refresh now**), CC current-status updates if it changed in Case Center, and `desiredStatus` / picks / handovers / reminders survive the merge.
   - Refresh the page; picks, handover, reminder survive (operator layer in localStorage).
   - Switch operator via the sidebar; confirm picked state behaves as expected for the chosen operator model (today picks are global per the existing implementation — call out in the release note if we keep that vs make picks per-operator).
3. Reopen `prototype/standalone.html` via `file://` after `node prototype/bundle.mjs`; the same walkthrough should work without a server.
4. With `local/serve.py` running and `local/casecenter.py` wired to a real account, run a live refresh and confirm picks/handovers/reminders survive the merge (the existing `CC_OWNED_FIELDS` overlay already guarantees this — verify, don't re-engineer).
