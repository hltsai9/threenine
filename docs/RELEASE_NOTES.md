# Release notes

Case Tracker prototype — changes by date. Newest first. Branch:
`claude/busy-heisenberg-26Sh8`.

Categories: **Added** (new features), **Fixed** (bug fixes), **Changed** (behavior/UX
changes), **Internal** (tests, refactors, CI), **Docs**.

---

## 2026-06-15

### Internal (Seed + promo deck)

- **Seed:** added a sample handover note to `C-2414` so the case-detail handover
  panel (and the promo-deck screenshot) have real content. No logic change.
- **Promo deck:** refreshed `slides/` screenshots against the current UI and
  rebuilt `Case-Tracker-Overview.pptx` (Route Board, current-vs-desired model,
  deploy story). `slides/` is outside the code dirs, but noting it here for trace.

## 2026-06-14

### Changed (Route Board — dot shows the real Case Center location)

- The Route Board dot now reflects a case's **current** Case Center location —
  derived from `assigneeDept` (matched against configurable `CC_CORE_DEPARTMENTS`
  / `CC_HQ_DEPARTMENTS` lists in `owners.js`) plus the latest non-`Unknown`
  process-timeline `processType`. Rules: latest `processType` `User` → User;
  Core dept + `Service Team` → Core Team; Core dept + `1st  Line` (or other) →
  1st Line; HQ dept → HQ; anything unrecognised → 1st Line.
- **Track Status is now strictly the *desired* location** — it decorates the case
  (moving/handoff animation, watch ring, sanity grouping) and sets the animation
  target, but never moves the dot. The Sanity Check / Case Closed `pinTo` override
  (and the now-unused `pinTo`/`watch` fields and dead `deptToRoleRaw`) were removed.
- New **1st Line** position: a static dot between User and Core Team with a dashed
  animated arrow each way (the "at triage, could go either way" cue). The
  stay / watch / sanity dots now sit at the case's real CC station, not a fixed spot.
- **Seed reshaped** to realistic Case Center records: assignee departments use the
  configurable values (`Site IT`, `HQ Identity`, `HQ Mobile`), process timelines
  carry real `processType` transitions (incl. `Unknown` at intake and `User` for
  user-held stages). Picked cases now span all four stations on the board.
- **Track Status "expected station" + intent arrows.** Each watch Track Status has an
  expected station (`escalated_to_hq` → HQ, `need_to_contact_user` → User). When the
  case is there, the settled dashed **watch ring** shows; when it isn't, the dot stays
  at the **real** CC station and a dashed animated **intent arrow** points toward where
  it should go (right → HQ, left → User) — the board never hides the true location.
  Scheduled statuses (Weekend / HQ-did-not-handle / Escalate-to-Core) are seeded **at
  User** so their arrows read User → target; Sanity Check shows the real station (mostly
  User). (See the addendum in the design spec.)
- Spec + plan: `docs/superpowers/specs/2026-06-14-route-board-cc-position-design.md`,
  `docs/superpowers/plans/2026-06-14-route-board-cc-position.md`.

## 2026-06-13

### Changed (Seed data — expanded to 38 cases for realistic testing)

- **`prototype/data.js` grown from 10 → 38 raw Case Center records** so a seeded
  DB / board looks realistic. The 10 curated records (tricky scenarios) are kept
  as-is; ~28 more are appended by a small in-file factory (`C-2411…C-2438`),
  still raw-CC shape (`CASES_RAW_CC`). Spread: 28 in the current week (W24), 10
  closed/dropped in the prior week (W23 → Weekly Archive). Status mix: 7 new, 8
  with-core, 7 with-HQ, 3 returned-to-requester, 10 closed, 3 cancelled.
- **`SEED_AGENT_LAYER` expanded to 13 picked cases** covering every Route Board
  lane: MOVING (weekend_case / escalate_to_core / hq_did_not_handle), WATCH
  (escalated_to_hq / need_to_contact_user), SANITY (sanity_check ×4), and STAY
  (picked-but-untracked). Generated via `node backend/seed_board_json.cjs`-friendly
  data, verified to map cleanly to board shape.

### Changed (Server mode auto-detects — no config flip needed)

- **`API_MODE='' ` now auto-detects** the backend: on boot the SPA probes
  `GET /healthz` and switches to server mode when a DB-backed `backend/api.py`
  answers. `file://`, GitHub Pages and the `serve.py` proxy have no `/healthz`,
  so they stay demo/single-user. `'server'` / `'demo'` remain explicit overrides.
  Removes the manual `config.js` step for a Render/backend deployment.

### Added (Auth — go-live step 2: shared-token login)

- **The SPA can now authenticate to a token-gated API**, so server mode works
  with `API_AUTH_TOKEN` set instead of having to leave the API open.
  - A blocking **login gate** collects the shared access token, validates it via
    the new `GET /api/auth/check`, and stores it in `sessionStorage` (cleared on
    tab close). Every `/api/*` call now carries `Authorization: Bearer <token>`
    (`withAuth()` wraps all five fetch sites).
  - **Re-auth on 401**: a token rejected mid-session re-opens the gate and
    re-pushes the operator's unsaved edits, so work isn't lost.
  - **Sign out** link in the sidebar (shown in server mode) clears the token.
  - Backend: `GET /api/auth/check` (login probe) and `GET /healthz`
    (unauthenticated liveness probe, e.g. for Render health checks).
  - Open APIs are unaffected — an empty token still passes `auth/check`, so no
    login prompt appears when `API_AUTH_TOKEN` is unset.
  - Scope: a single shared team secret, not per-operator identity (that's a later
    step); "who did what" is still the in-app operator switcher.

### Added (Deploy — no-shell seeding)

- **`backend/seed_board_json.cjs`** emits the demo seed as board-shaped
  `{"cases":[...]}` (running the prototype's own mapper headlessly), so a hosted
  DB can be seeded over the public API — `node backend/seed_board_json.cjs | curl
  -XPOST .../api/save` — with no Case Center access, no Python, and no shell on
  the server. Complements `seed_extract.cjs` (which prints raw, unmapped records).

### Changed (Deploy — Render Postgres paste-and-go)

- **`backend/db.py` normalises the DB URL scheme.** Managed providers (Render,
  Heroku) hand out `postgres://` / `postgresql://`, which SQLAlchemy rejects or
  maps to the un-bundled psycopg2 driver. It now rewrites both to
  `postgresql+psycopg://`, so the provider's connection string can be pasted
  verbatim into `DATABASE_URL` (Alembic gets it too via `env.py`).
- **`psycopg[binary]` is now installed by default** in `backend/requirements.txt`
  (prebuilt wheel, no native build; only used when `DATABASE_URL` is Postgres) so
  a Postgres deploy doesn't crash on a missing driver.

### Added (Server-authoritative operator layer — go-live step 1)

- **The SPA can now treat the DB API as the source of truth for the operator
  layer** (picks / Track Status / handover / reminder), so the board is shared
  across operators and devices instead of being browser-local. Enabled by
  `window.API_MODE = 'server'` in `prototype/config.js` (default `''` keeps the
  existing single-user/demo + `serve.py` behavior).
  - `backend/api.py` `GET /api/cases` now advertises `operatorLayer: "server"`.
  - In server mode the SPA boot-loads the **full** DB store (`tryLoadLiveCases(true)`,
    no Case Center look-back window), **skips** the `localStorage` operator-layer
    overlay so it can't clobber another operator's saved work, and still
    round-trips every edit through `POST /api/save` → `merge.upsert_operator`.
  - Falls back to local/seed data with a warning if the API is unreachable.
  - Known limitation (deferred to step 2 / auth): operator *identity* is still the
    in-app switcher, and in server mode it's session-only (not persisted in
    `localStorage`). No cross-operator live push yet — refresh to see others' edits.

### Fixed (Security — review batch)

- **XSS / injection hardening at the data boundary.** Untrusted Case Center
  `caseId` and `caseLink` values flowed unescaped into many `innerHTML`,
  attribute and `href` sinks. Added `safeId()` (strips markup/attribute-breakout
  chars), `safeUrl()` (allows only `http(s):`, rejecting `javascript:`/`data:`)
  and `sanitizeCaseIdentity()`, applied at every point a case enters `STATE`
  (`buildSeedCases`, `normalizeLiveCase`, `overlayLiveCase`). `caseHref()` now
  also refuses non-http(s) links, and the two unescaped owner-id `<option>`
  sinks are escaped. Locked in by 7 new tests (`prototype/tests/run.cjs`).
- **Backend API now supports authN/authZ.** `backend/api.py` gained an
  `API_AUTH_TOKEN` bearer-token gate (constant-time compare) on `/api/cases`
  and `/api/save`; unset = open (demo preserved) but logs a warning. Previously
  anyone reachable could read all case PII and purge any case via `purgeIds`.
- **Live capture can no longer clobber the public seed.** `local/persist.py`
  refuses to overwrite the Pages-deployed `prototype/data.js` unless
  `CASE_TRACKER_ALLOW_DATA_JS_OVERWRITE=1`, closing the accidental-PII-to-public
  leak that previously relied only on a manual `skip-worktree`.

### Fixed (Accessibility — review batch)

- **Visible keyboard focus everywhere.** Added a global `:focus-visible` ring
  and replaced the bare `outline:none` on `.op-switcher`; keyboard/low-vision
  operators can now see what's focused.
- **Muted text meets WCAG AA.** Darkened `--text-faint` / `-2` / `-3` and
  `--sidebar-muted` (were ≈3.6 / 2.9 / 2.4:1 on white) to ≈5:1 — these carry
  triage metadata scanned under time pressure.
- **Reduced-motion support.** Added `@media (prefers-reduced-motion: reduce)` to
  neutralise the always-on route-board travelling dot, WATCH ring pulse and
  overdue-bell pulse.
- **Accessible modals.** `showModal` now renders `role="dialog"`/`aria-modal`,
  autofocuses the first field, supports Escape-to-close + a Tab focus-trap, and
  returns focus to the opener on close. Blocking `alert()` validation replaced
  with inline, `role="alert"` messages (`modalError`).

### Changed (UX — review batch)

- **Onboarding tour rewritten for the current UI.** `tour.js` described the
  removed kanban board (four columns, `+ Queue`, case `C-1044`); it now walks the
  Picked workspace, Hand-off Route Board, Overview triage, Shifts and Owners, and
  silently skips any step whose anchor is missing instead of pointing a tooltip at
  nothing. Storage key bumped to `v2` so returning users see the corrected tour.
- **Actionable empty workspace.** An empty Picked list no longer dead-ends on a
  link to Overview — it now surfaces the most recent unpicked open cases with a
  one-click **+ Pick**, so day-one triage starts on the landing view.

### Internal (review batch)

- Removed dead `renderKanbanCard` shim + `_legacyRenderKanbanCard` (unreachable
  since the kanban removal; still carried `${c.id}` sinks and bundle weight).
- Debounced the case-filter input (~120ms) and dropped its dead `.kanban-card`
  branch.
- Atomic upserts in `backend/merge.py` (`SELECT … FOR UPDATE` on dialects that
  support it; SQLite serialises) to close the ingest+save lost-update window —
  `CC_OWNED_FIELDS` merge semantics unchanged. Per-record try/except in live
  ingestion (`local/casecenter.py` `map_records`) so one bad case is skipped, not
  fatal. `print()` → `logging` on the touched API/ingest paths.

### Docs (review batch)

- `docs/SETUP.md` documents `API_AUTH_TOKEN` and the `data.js` overwrite guard;
  `backend/README.md` / `local/README.md` updated for auth and the capture guard.

> Note: the review also recommended a full `app.js` module split and an
> event-delegation rewrite (maintainability/perf, high regression risk) — these
> are deferred to a follow-up (see `docs/improvement-plan.md`). The reviewer's
> "restore chase/escalate verbs" suggestion was intentionally **not** taken:
> `renderDetailActions` documents those as deliberately moved to Case Center, and
> they remain reachable via the contextual prompt surface.

### Changed (Seed data · raw Case Center shape)

- **`prototype/data.js` rewritten as raw Case Center records.** Each entry is
  one CC record (`caseId`, `caseStatus`, `subStatus.transition`, `caseLevel`,
  `userAccount`, `userDept`, `reporter`, `assignee`, `createDateTime`,
  `processTimeline[]`) — the same shape `fetch_raw()` in `local/casecenter.py`
  returns from a real Case Center query. A new `window.CASES_RAW_CC = true`
  flag tells `app.js` to run each record through `mapRawCcRecord()` +
  `fillBoardDefaults()` at boot, so the renderers always see the board shape
  they expect (`status` enum, `priority`, `caseLink`, mapped `processTimeline`,
  derived `assigneeDept`, `waitUser{}`).
- **Smaller, focused seed (10 cases on W24-2026).** Two New, two With Core
  Team, two With HQ, one Returned-to-requester (`In-Progress` + `Wait User`),
  one Return-from-user (`In-Progress` + `Return`), one Closed, one Dropped —
  covering every entry in the CC → board status map.
- **`window.SEED_AGENT_LAYER`** sits next to `window.CASES` and overlays the
  operator-side fields (picks + Track Statuses) onto specific cases AFTER
  mapping. The seed is intentionally light: C-2402 picked as *Weekend Case*
  (a MOVING lane on the Route Board); C-2405 and C-2406 picked as
  *Sanity Check* (so the collapsible bottom group has more than one row).
  Other Track Status variants are one click away in the picker.

### Internal (CC mapping ported to JS)

- New helpers in `app.js` mirror `local/casecenter.py:map_record`:
  - `CC_STATUS_MAP` / `CC_STATUS_MAP_BY_STATUS` / `CC_STATUS_MAP_BY_PROCESS_TYPE`
    (lookup tables — keep in lockstep with the Python).
  - `_ccSubTransition`, `_ccLastProcessType`, `_ccMapStatus`, `_ccStatusLabel`,
    `_ccDeptFromTimeline`, `_ccMapProcessTimeline`, `_ccMapWaitUser`.
  - `mapRawCcRecord(r)` — the JS twin of Python's `map_record(r)`.
  - `fillBoardDefaults(c)` — sets `weekId`, operator-layer defaults
    (`agentStatus`, `trackStatus`, `currentOwner`, `slaPaused`, …) so a
    freshly-mapped record renders straight away.
  - `applySeedAgentLayer(cases, overlay)` — applies `window.SEED_AGENT_LAYER`.
  - `buildSeedCases()` — picks the right seed flavour (live-capture, raw CC,
    or legacy board-shape) and returns the populated array.
- `STATE.cases` initialises empty; `anchorFreshSeed()` now calls
  `buildSeedCases()` to populate it (the helpers must be defined first).
- Storage version bumped **`v7 → v8`** so existing snapshots force a fresh
  seed on next load.
- Tests adjusted: structural seed checks accept the raw shape (`caseId`)
  when `window.CASES_RAW_CC` is set, `SCRATCH_ID` resolves through the
  active id field, and the recycle-bin time-comparison test anchors its
  inputs on `app.realNow()` (the sandbox-frozen clock) so it stays
  deterministic regardless of how far the host wall-clock has drifted from
  the seed's `window.NOW`.

### Changed (CommuGround Forest theme polish)

- **Sidebar navigation grows icons.** Each nav row (`Picked`, `Overview`,
  `Shifts`, `Owners`, `Status Flow`, `Clock model`) now carries an inline
  SVG icon that tints `--accent-soft` on the active route and `--text-muted`
  on hover. New `.nav-icon` / `.nav-label` CSS hooks keep alignment crisp.
- **Operator card** in the sidebar footer is redesigned around an `.op-id`
  block (logo-gradient avatar + "On shift" cap + borderless `.op-switcher`
  select) with the per-fact rows (`Shift`, `Ends`, `Week`) sitting under
  it. Brand block drops the "prototype" badge and adds a "SUPPORT × SRE"
  serif sub-line.
- **Themed dropdowns.** `.op-switcher` and `.ts-picker` now match the
  Forest palette — custom chevron, hover/focus rings, and a fully styled
  open popup (`@supports (appearance: base-select)`) with selection
  checkmarks. Falls back gracefully on browsers without
  `appearance: base-select`.
- **Forest link colors everywhere.** A zero-specificity `:where(a)` rule
  paints content hyperlinks `--accent` with a soft underline; UA blue and
  visited purple are gone. `.btn`, `.nav a`, `.muted` links keep their
  own colors because the selector has no weight.
- **Route Board same-station fix.** When a scheduled handoff's `from` and
  `to` resolve to the same station (e.g. a Weekend Case whose CC
  `assigneeDept` already maps to HQ), the MOVING row no longer draws a
  zero-length line with a detached arrowhead stacked on the dot — it just
  renders the "at station" marker.
- Misc alignment polish across the Route Board (origin dot 3px white
  border + #3f6e5e shadow, station square colours nudged), `.shift-info`
  card padding, and the brand block.

### Internal

- `prototype/standalone.html` regenerated from the modular sources to
  capture every CSS / JS / HTML change in one self-contained bundle.

---

## 2026-06-12

### Changed

- **Picked workspace replaces the kanban-by-CC-status board.** `#/cases` is now a
  two-zone layout (per `docs/case-center-overview-plan.md` §1/§6): an aggregate
  **Route Board** strip across the top (three stations: User · Core Team · HQ, one
  lane per picked case with a dot at the current station, animated arrow to the
  next stop, eyeball icon for the two "watching" track statuses, ✓ closed/delivered
  badges, and a collapsible Sanity Check group pinned to the bottom) and a 1:2
  list+detail split below. The old kanban grouping, two-band (queued/backlog)
  split, drag-between-columns handler, and CC status columns are gone — `#/archive`
  (renamed **Overview** in the sidebar) is the full Case Center library, and cases
  reach the Picked workspace via the Pick button on every Overview row.
- **Track Status is the only operator-set field on a picked case.** New 7-value
  enum on the case detail panel picker (Weekend Case · HQ did not handle · Escalate
  to Core Team · Escalated to HQ — keep an eye · Need to contact user · Case Closed
  · Sanity Check). It is stored in the agent layer (`agent-v1` localStorage and
  `POST /api/save`), never sent to Case Center. The picker shows all seven to every
  shift; suggested-for-your-shift options carry a ★ hint. The first three carry
  scheduled handoff rules driving the Route Board arrows (Weekend Case → Sun Day
  17:30, HQ did not handle → next Day 17:30, Escalate to Core Team → next Day
  09:00). Case Closed and Sanity Check pin the lane's dot to *User* regardless of
  CC `assigneeDept`; Sanity Check uses the case subject as the dot tag.
- **CC-shaped action surface removed.** The status-transition dropdown and per-
  status buttons (Assign to Core, Escalate to HQ, Chase owner, Verify fix, Return
  to requester, Move to sanity check, Close, Cancel, Reopen) are gone from the
  detail panel — operators do all that work in Case Center. The detail panel now
  exposes the Track Status picker, **Clear Track Status** (with a soft-warning
  precondition check: CC `assignee` should match the route's To station for
  scheduled types, CC status should be `closed`/`cancelled` for *Case Closed*, and
  a fresh handover note should exist), **Open in Case Center** (existing
  `caseLink`), **Write handover**, **Set reminder**, and **Pick/Unpick**.
- **`flags[]` field dropped from the rendered UI** (kanban card, archive table,
  case detail header). The Track Status pill replaces it.
- **Sidebar renames:** *Board → Picked*, *Weekly Archive → Overview*, with Picked
  on top and Overview directly below.
- **Owner directory (`owners.js`) gains a `route_role` field** on each Core Team
  desk and HQ Product Team row (one of *Core Team* / *HQ* / *User*). The Route
  Board looks up CC's `assigneeDept` against these rows to decide which station
  the dot sits at; unmapped depts fall back to *User*.
- **"+ New case" renamed "+ Import case by ID"** to reflect that it pulls one
  existing Case Center case by id (never creates a new case there).

### Internal

- New helpers: `TRACK_STATUSES`, `TRACK_STATUS_BY_ID`, `TRACK_GROUP_ORDER`,
  `caseTrackStatus`, `isPicked`, `pickedCases`, `deptToRoleRaw`, `caseStation`,
  `scheduledHandoff`, `trackStatusPhase`, `actionDueCases`, `actionOverdueCases`,
  `caseRouteLane`, `renderRouteLane`, `renderRouteBoardStrip`, `trackStatusPill`,
  `renderPickedListRow`, `renderPickedList`. `agentLayerFromState` /
  `applyAgentLayer` now carry `trackStatus`. `statusTransitions` kept as a no-op
  shim so any external caller doesn't break. `renderKanbanCard` is now an empty
  shim; the dead body remains as `_legacyRenderKanbanCard` for a follow-up sweep.
- New CSS block at the end of `styles.css` for the Picked workspace grid, the
  three-station Route Board with `route-pulse` keyframe, Track Status pills,
  picked-list rows, and Sanity Check collapsible group.
- Tests updated to match the new history kinds (`picked` / `unpicked` instead of
  `queue_added` / `queue_removed`) and the empty `statusTransitions()` shim. Test
  that asserts a case appears on the board now selects a queued seed case
  explicitly. All 77 tests pass.

### Docs

- `docs/case-center-overview-plan.md` — the agreed plan that drives this change.

### Added (follow-up)

- **More demo Track Status seeds** so the Picked workspace populates every variant
  out of the box: `weekend_case` (C-1041), `escalate_to_core` (C-1043),
  `escalated_to_hq` (C-1044), `sanity_check` (C-1045, C-1050, C-1053, C-1054),
  `need_to_contact_user` (C-1046), `hq_did_not_handle` (C-1048), `case_closed`
  (C-1049). Each seed also gains an explicit `assigneeDept` so the Route Board's
  From-station derivation (via the new `route_role` field in `owners.js`) has
  something concrete to look up. The Sanity Check collapsible group now has
  four members so its collapse/expand behaviour is visible.

### Internal

- `.github/workflows/pages.yml` — branch `claude/vigilant-knuth-slap60` added to
  the deploy triggers so the GitHub Pages site picks up this branch's bundle.

### Changed (Case history · operator name instead of id)

- **Case history rows now show the operator's name** ("Mia (DA)") instead of
  the raw operator id ("op-da"). Lookup goes through `getOperator(h.who)`;
  if the id is unknown (e.g. an old import) the row falls back to the
  literal `who` field so nothing breaks.

### Changed (Process timeline · legend grouped by processType)

- **Process-timeline legend now groups by `processType`** — the same key the
  bar segments use for their visible label — so legend rows align with what
  you see on the bar. Falls back to `ccStatus` / mapped board-status label
  when a stage has no `processType`. Entries that aggregate two or more
  stages also show "· N stages" beside the duration.

### Added (Picked workspace · collapse the list)

- **Toggle button to hide / show the picked case list.** The list pane (left
  1/3 of the bottom zone) carries a new header row with "Picked cases (N)"
  on the left and a "◂ Hide" toggle on the right. Hiding the list collapses
  the grid to a single column and expands the **case detail** pane to fill
  the full width; a floating "▸ Show list" button appears at the top-left
  of the detail so the operator can bring the list back. State persists
  across renders via `STATE.pickedListCollapsed`.

### Changed (Handover note · names on both sides; WATCH ring pulses until you act)

- **Handover note meta now spells out both sides by name** (and shift). It
  reads e.g. *"From Mia (DA) (Day) → To Ren (NA) (Night) · 2026-06-12 18:30"*
  rather than the old shift-only "Day → Night · op-da" line. When the
  handover was addressed to a specific operator (via the "Hand over to…"
  picker) the recipient block shows that operator's name and shift; for
  generic end-of-shift handovers it falls back to the target shift label.
- **WATCH ring pulses while the case still needs your hand-off.** On the
  Hand-off Route Board, every WATCH lane's dashed circle now animates —
  shrinking down to the size of the solid dot and expanding back — until
  the current operator has personally authored a fresh, non-stale handover
  note for that case. Once you've handed it over, the ring goes quiet.

### Changed (Route Board · WATCH covers need_to_contact_user)

- **`need_to_contact_user` moves from STAY to WATCH** on the Hand-off Route
  Board. The WATCH row is now station-aware: the dashed ring + solid dot +
  amber eye render at the watched station (User at 12% for *Need to contact
  user*, HQ at 88% for *Escalated to HQ — keep an eye*) using the matching
  station colour for the dot (`#33596B` / `#8C4A2F`). The case id sits to
  the right of the eye.
- The STAY row no longer carries the blue-grey outline eye icon — that case
  type now renders as a WATCH row at User.

### Added (Detail panel · Hand over to a specific operator)

- **"Hand over to…" picker** in the case detail panel toolbar. Lists every
  operator other than the current one (with their shift); selecting an
  operator opens a handover modal pre-addressed to that person. The saved
  handover gets a new `toOperator` field on top of the existing
  `from`/`to` shift labels, and the history entry records the recipient's
  name (e.g. *"Handover to Mia (DA) (Day → Day)"*). The original
  *Write handover note* button stays for shift-to-shift handovers without
  naming a recipient.

### Added (Shifts page · multi-week rota)

- **Per-week rota editing.** The Shifts page rota editor now lets the team
  edit not just *this week* but also the next three weeks (current → W+3, four
  tabs in total: e.g. W24 · W25 · W26 · W27). Selecting a tab swaps the
  schedule grid to that week's rota; saving persists every changed week.
- New seed in `shifts.js`: `window.ROTA_BY_WEEK = { 'W24-2026': window.ROTA,
  'W25-2026': […], 'W26-2026': […], 'W27-2026': […] }`. The current week's
  entry is the same array as `window.ROTA` so existing reads keep working.
- `window.WEEKS` extended with W25 / W26 / W27 (`isFuture: true`) so the
  archive index also surfaces the upcoming buckets.
- `rosterSnippet()` emits a multi-week block (`window.ROTA_BY_WEEK = { … }`)
  alongside the original `window.ROTA = [ … ]` so a copy/paste captures
  every edited week.
- `scheduledHandoff()` now picks the rota for the week containing the
  computed `dueAt`, so a "next Day shift" lookup that crosses into a future
  week honours that week's edited schedule.

### Fixed (small)

- **Importing a case by ID auto-picks it.** Typing a Case Center ID into the
  `+ Import case by ID` modal now sets `agentStatus = 'queued'` on the new
  case (provided it isn't already closed/cancelled) so it lands directly in
  the Picked workspace and on the Route Board. The "Added from Case Center"
  toast now ends in "· picked." to confirm.

### Changed (Hand-off Route Board — spec build)

- **Rebuilt the Route Board to the agreed spec.** Replaces the earlier "three
  station cells, per-cell arrow segments" prototype with a band + card +
  absolute-positioned rows layout:
  - **Band** (full-width, `#234231` background, 4px `#2E5641` bottom border)
    with title row (amber dot · "HAND-OFF ROUTE BOARD" · "N moving · M overdue
    · K watch" summary) and a right-side legend.
  - **White card** inside the band (`#C5CCC1` border, 16px radius), with three
    full-height dashed guide lines at 12% / 50% / 88% and station labels
    above (USER `#33596B` · CORE TEAM `#8A3434` · HQ `#8C4A2F`).
  - **Four row types**, each absolutely positioned by computed top offset:
    - *MOVING* (66px) — solid origin dot at the From station, 3px route line
      to the destination (green `#2E5641` or red `#B05050` when overdue), CSS-
      triangle arrowhead, hollow destination ring, animated traveling dot
      (3.4s ease-in-out, each row delayed +0.55s), and a deadline chip above
      the line at 31% (Core) or 70% (HQ) with "today HH:MM" / "Sun HH:MM" /
      "overdue HH:MM" text.
    - *WATCH* (60px) — `escalated_to_hq` cases. Dot at HQ with 34px dashed
      ring, amber outline-eye icon, id to the right. No route line.
    - *STAY* (48px) — `case_closed` / `need_to_contact_user` / untracked.
      Quiet `#A8BCA8` dot at User with "id · stays" mono label.
      `need_to_contact_user` gets a 15px blue-grey outline eye icon to the
      dot's left.
    - *SANITY* (46px) — collapsed header showing "Sanity Check · N cases"
      with a 20px +/- toggle. Expanded reveals one 38px sub-row per case
      with a 10px pale `#CBD8BF` dot and "id · subject" mono label.
- **New typography:** Google Fonts adds *Lora* (headings), *IBM Plex Sans*
  (band/UI), and *IBM Plex Mono* (ids and chips). Existing Source Serif 4 /
  Libre Franklin / IBM Plex Mono links are retained for the rest of the app.
- All Route Board class names moved from `.route-*` to `.rb-*` so the old
  prototype CSS doesn't bleed through.

### Fixed (Route Board polish)

- **Arrow line and arrowhead no longer separated by an empty gap.** The line
  rendered as three tiled per-cell segments (start = right half of From cell,
  middle = full cell, end = left half of To cell) and the arrowhead is anchored
  at the To station's centre (the same point the dot would occupy), so the line
  and head visually attach.
- **Route due time now displays in MST** (the shift timezone, `SHIFT_TZ_LABEL`),
  matching the rest of the shift-time UI. Was previously rendering as the
  viewer's local time. `scheduledHandoff()` likewise interprets the rule's
  `hh:mm` in MST and walks MST-days when picking the next occurrence, so e.g.
  "Sunday Day 17:30" lands on Sunday in MST regardless of the viewer's locale.
- **Dot for cases whose CC `assigneeDept` resolves to an HQ Product Team or Core
  Team desk now correctly lands at the HQ or Core Team station.** The fix was
  the storage version bump (`v6` → `v7`) — operators with a `v6` snapshot in
  `localStorage` were reading back the pre-refactor seed (no `assigneeDept`),
  so every dot defaulted to *User*. v7 forces a one-time re-seed; from then on
  the snapshot carries `assigneeDept` and the dept→role lookup in `owners.js`
  resolves correctly.

---

## 2026-06-11

### Changed

- **Status Flow page now documents the updated Case Center mapping.** Added a new
  "Case Center → board mapping" section below the existing operator-transitions table
  that surfaces the three lookup tiers `map_status()` consults — in lookup order, with
  pills for the resulting board column and a one-line "why" per row:
  1. `(caseStatus, subStatus.transition)` exact pair (most specific; short-circuits).
  2. Last `processTimeline[*].processType` refinement
     (`"1st  Line"` → New, `"Service Team"` → With Core Team).
  3. `caseStatus` alone as the coarse fallback.
  Renamed the existing "Transitions reference" to "Operator transitions" and added a
  short blurb clarifying it's the in-app actions (Change status… / Assign / Return-to-
  requester) vs. the Case Center mapping which runs on every live refresh. The page
  also calls out that `subStatus` is the new shape (the old `caseSubstatus` field is
  gone), that `"1st  Line"` literally has two spaces, and that `status` is now a CC-
  owned field so the column follows Case Center automatically across refreshes.
  Tables kept in sync with `local/casecenter.py` by hand.

### Fixed

- **Selecting a kanban card no longer scrolls each column back to the top.** The
  previous fix preserved the window scroll across the re-render, but `.kanban-col-body`
  has its own `overflow-y: auto / max-height: 70vh` — replacing `main.innerHTML` rebuilt
  every column from scratch, so any column the user had scrolled down inside snapped
  back. The click handler now also snapshots each `.kanban-column`'s body `scrollTop`
  before render and restores it after.

### Added

- **Editable team members on the Owners page (Core Team + HQ).** The read-only roster
  is now an editor: each team card shows its members in a 3-column grid (name / role /
  id) with a `+ Add member` button and a per-row ✕ to delete. Edits flow through the
  same Save / Copy snippet path the desks/teams use, so members survive a reload and
  can be copied back into `owners.js`. HQ teams gained a `members[]` array in
  `prototype/owners.js` seeded with three members per team; `ownersSnippet()` now emits
  the members block for both pools.

### Changed

- **"This week's rota" now has a Day cell and a Night cell per day, each holding any
  number of operators.** Replaced the single-operator-per-day grid with a `92px +
  repeat(N,1fr)` matrix: a header row of day labels and one row per shift in
  `window.SHIFTS` (defaults Day, Night). `window.ROTA` reshaped to
  `[{ day, shifts: { Day: [opId, …], Night: [opId, …] } }, …]`; a new `normalizeRota()`
  migrates older snapshots / the prior single-operator format on load. Drag drops onto a
  cell append (no duplicates); dragging a chip onto another cell moves it; a per-chip ✕
  removes one. `rosterSnippet()` emits the new shape; **Save rota** still snapshots into
  `SEED_ROSTER.rota`, writes localStorage, and (on http(s)) calls `saveJsFile('shifts',
  …)`. CSS updated: `.rota-cell` is now a flex column of pill-shaped `.rota-assigned`
  chips, with `.rota-corner`, `.rota-head`, and `.rota-row-label` for the matrix's
  outer cells.

### Fixed

- **Shift detail page no longer reads as "a stack of unstyled blocks".** Everything
  below the page-header (tabs, summary stats, roster, cases-handed-to, missing notes,
  recent handover activity) is now wrapped in a single `.card` + `.card-body` with
  `.detail-section` regions — same pattern as the case detail page — instead of four
  free-floating `.section-block` panels. The page-header gets a clean title-left,
  `← Shifts` button-right layout (with the "On now"/"Off shift" badge inline). Also
  promoted `.badge-current` from `.archive-card .badge-current` to a top-level rule so
  it actually styles the badge on the Shifts index card and the detail header (it had
  no style before outside the archive view).
- **`.case-row` works outside `.section-block-body`.** The grid layout (`1fr 220px
  120px`) was nested under `.section-block-body .case-row`, so the case rows in the
  rebuilt shift detail (which uses `.detail-section`) had no grid and rendered as
  three stacked, unstyled divs — that was the "out of style" you were seeing. The rule
  is now top-level; the `.section-block-body .case-row` selector keeps the 18px gutter
  override so the existing handover screen still looks the same.
- **Clicking a kanban card no longer jumps the page to the top.** The select handler
  now captures `window.scrollX/Y` before `render()` and restores it after, so picking
  a card further down the board keeps the viewport where it was. Affects every column
  / band, not just `is-mine` cards.

### Changed

- **"Assigned to me" cards float to the top of their column.** Extended `sortCases`
  in `renderCaseList` to order by `isAssignedToMe(c)` first (mine → top), then the
  existing priority and createdAt tiers. Applies inside both the queued and backlog
  bands.

- **Complete `fit` → `core` internal rename.** Every remaining `fit` identifier and
  string token swapped to `core` so the codebase reads consistently with the user-visible
  "Core Team" naming. Status enum `'with_fit'` → `'with_core'` (and its CSS class
  `pill-with_fit` → `pill-with_core`); ownership-timeline class `tl-fit` → `tl-core`.
  Case fields `c.fitId` → `c.coreId`, `c.fitCannotResolve` → `c.coreCannotResolve`;
  `c.holdMs.fit` → `c.holdMs.core`. Owner pool `window.OWNERS.fit` → `window.OWNERS.core`
  (the dict key in the snippet writer too). Prompt kinds `assign_fit` / `chase_fit` →
  `assign_core` / `chase_core`. Threshold `window.THRESHOLDS.fitIdleHours` →
  `coreIdleHours`. Owner-type literal `'fit'` → `'core'` (used by `currentOwner`,
  `getOwner(type, …)`, `data-type` attributes, the `dest === 'fit'` resume switch).
  Local variables in the affected scopes (`const fit`, `fitMs`, `fitName`) renamed too.
  The history-detail matcher regex in `holderTotals` was rewritten from `/local
  fit|→ fit|\bfit\b/` to `/core team|→ core|\bcore\b/i` so it still classifies the
  renamed "Core Team — …" detail strings as Core Team time. `holderTotals` now
  returns `{ triage, core, hq, requester }` (was `{ triage, fit, … }`); the
  characterization tests follow. `local/casecenter.py` `STATUS_MAP_BY_PROCESS_TYPE`
  maps `"Service Team"` to `"with_core"`. The CSS `auto-fit` grid keyword is
  unaffected (it's a CSS spec value, not a domain identifier). Everything compiles
  and 77/77 tests pass.

### Added

- **"This week's rota" editor on the Shifts page (drag-to-assign + save).** New card
  above the existing roster editor with two sections: a horizontal "Operators" palette of
  draggable chips (one per `window.OPERATORS` entry, showing initials + name + shift) and
  a seven-day "Schedule" grid (Sun → Sat, matching the new week-start convention). Drag
  an operator onto a day to assign; drag an assigned cell to a different day to move it;
  hover an assigned cell and click ✕ to clear it. The current rota is held in `window.ROTA`
  (an array of `{ day, operatorId }`); the **Save rota** button snapshots the current
  state, persists it to `localStorage` via the shared `saveState()`, regenerates the
  `shifts.js` snippet so it captures the rota, and (when running on http(s)) calls the
  same `saveJsFile` path the roster editor uses. **Reset to seed** restores the rota to
  the data.js values. Wired through `bindRotaEditor()` using HTML5 drag-and-drop with
  drag-over styling on the target cell. Helpers added: `operatorInitials(op)`,
  `operatorColor(op)`, `rotaDirty()`. CSS: `.rota-editor`, `.rota-palette`, `.rota-chip`,
  `.rota-grid`, `.rota-day`, `.rota-cell`, `.rota-assigned`, `.rota-avatar`. Default seed
  has Mon/Wed/Fri = Mia, Tue/Thu = Kai, Sat/Sun empty.

### Changed

- **`fit-` id prefixes renamed to `core-` across owners.js and seed data.** Desk ids in
  `prototype/owners.js` are now `core-apac` / `core-emea` / `core-amer` (and member ids
  follow: `core-apac-lead`, `core-apac-eng`, etc.). All `fitId: 'fit-…'` references in
  `prototype/data.js` and the test fixture in `prototype/tests/run.cjs` rewritten to
  match. `makeOwnerId(pool, name, …)` in `prototype/app.js` now slugs Core Team desks
  under a `core-` prefix (HQ teams stay `hq-`); the id input placeholder follows. The
  `window.OWNERS.fit` pool key, `c.fitId` field name, `holdMs.fit`, and
  `currentOwner === 'fit'` are state-shape and stay as-is.
- **Finish the "Core Team" rename — owner names, modals, toasts, snippets, seed
  history.** Renamed `window.OWNERS.fit` entries from `"FIT — APAC/EMEA/AMER desk"` to
  `"Core Team — APAC/EMEA/AMER desk"` (Slack channels followed: `#core-apac` etc.).
  Updated the Owners page placeholder (`"Core Team — … desk"`), the editor card header
  ("Edit Core Team desks & HQ teams"), the `+ Add Core Team desk` button, the delete-flow
  `kind` label, and the warnings line. The owner-name prefix-stripping regex on the
  board card now also matches `"Core Team — "` (in addition to legacy `FIT|HQ`).
  `makeOwnerId()` strips `core` along with the other boilerplate so a new "Core Team — X
  desk" still slugs cleanly. Assign / escalate / chase / resume strings now say
  "Core Team" instead of "FIT" (assign modal subtitle + label, escalate modal subtitle +
  reason placeholder, escalate history `'Core Team → …'`, escalation toast, chase toast,
  resume "Core Team/HQ cleared", reminder modal hint, SVG flow node label, status-flow
  table cells, Clocks legend row). Seed cases in `prototype/data.js` updated to match
  (history `detail`, handover notes, process-timeline `processor`, `handlerType`,
  free-text `notes`). `tour.js` updated likewise. Internal state — `with_fit` enum,
  `pill-with_fit` CSS class, `currentOwner === 'fit'`, `fitId`, `holdMs.fit`,
  test-internal `const FIT` — all unchanged.

### Added

- **Three Core Teams seeded with three members each.** Each `window.OWNERS.fit` desk now
  carries a `members` array (`id` / `name` / `role`) — APAC: Hana Park (lead), Kenji Sato,
  Mei Lin; EMEA: Lukas Berg (lead), Sofia Ricci, Omar Haddad; AMER: Jordan Reed (lead),
  Ava Nguyen, Diego Alvarez. The Owners page renders a "Core Team members" read-only grid
  below the existing tables and `ownersSnippet()` writes `members:` so saved snippets
  preserve the roster.
- **"Assigned to you" highlight on board cards.** `renderCard` now adds an `is-mine`
  class and a small `● me` chip when `c.assignee` matches the current operator's id or
  name (case-insensitive), via a new `isAssignedToMe(c)` helper. CSS gives those cards a
  tinted background, an accent ring, and a stronger highlight when also selected. Two
  seed cases (C-1041, C-1044) carry `assignee: 'op-da'` so the highlight is visible in
  the demo out of the box.

### Changed

- **Case Center refresh now moves cases when their status changes.** Added `status` to
  `CC_OWNED_FIELDS` in `prototype/app.js`, `local/persist.py`, and `backend/merge.py`, so
  a live refresh updates the board column to whatever Case Center currently has. The
  operator's local layer (FIT/HQ routing, notes, clocks, queue, handover, reminders) is
  still preserved across a refresh — only the CC-owned fields change. Updated the
  `mergeLiveCase` characterization test to expect status to follow CC.
- **"Local FIT" wording → "Core Team" everywhere user-visible.** Renamed across
  `prototype/app.js`, `prototype/data.js`, `prototype/owners.js` doc comments,
  `prototype/tests/run.cjs`, and `prototype/tour.js`. The internal status enum
  `with_fit` and the pill CSS class `pill-with_fit` are unchanged (column id stays).
- **Week boundaries start on Sunday.** `window.CURRENT_WEEK` and `window.WEEKS` in
  `prototype/data.js` shifted by one day: W24-2026 now spans Sun Jun 7 – Sat Jun 13,
  W23 spans May 31 – Jun 6, W22 spans May 24 – 30, W21 spans May 17 – 23 (labels
  rewritten accordingly). A new `WEEK_STARTS_ON = 0` constant in `app.js` encodes the
  Sunday-first convention for future code.
- **Auto-create a week bucket when a new case has no matching window.** `normalizeLiveCase`
  now resolves `weekId` via a new `weekIdFor(createdAt)` helper that searches `window.WEEKS`
  for a containing `[startsAt, endsAt)` window; on no hit it builds a fresh week anchored
  to the Sunday at-or-before `createdAt` (with a `weekNumberFor()` / `weekLabel()` helper
  pair) and inserts it sorted in `window.WEEKS`. Cases now always land somewhere, even
  if they pre-date or post-date the seed week list.
- **Shift times rendered in Mountain Standard Time.** Added `SHIFT_TZ = "America/Phoenix"`
  / `SHIFT_TZ_LABEL = "MST"` and reworked `fmtLocalTime` / `fmtShiftHoursLocal` to format
  via `Intl.DateTimeFormat` with a `timeZone` option (with a hard-coded UTC-7 fallback
  if Intl rejects the IANA name). The sidebar shift-ends clock, the Shifts page roster
  headers, and shift-card subtitles all now show MST; case timestamps still render in
  the viewer's own local time via the unchanged `fmtAbsolute`.

- **Follow-ups to the Case Center JSON adapter.** `map_process_timeline()` now reads each
  item's sub-transition via the shared `sub_transition(it)` helper instead of the removed
  `caseSubstatus` field, keeping the per-stage logic consistent with the top-level
  `subStatus.transition` change. `map_wait_user()` drops `handlerGrp` from
  `lastProcessor` (Case Center no longer carries it). Added a `STATUS_MAP_BY_PROCESS_TYPE`
  table next to `STATUS_MAP_BY_STATUS` to disambiguate "In-Progress" using the last
  `processTimeline` item's `processType`: `"1st  Line"` → **new**, `"Service Team"` →
  **with_fit**. `map_status()` now takes an optional `last_pt` argument and consults the
  new table between the (status, substatus) pair lookup and the caseStatus-alone fallback;
  `map_record()` passes the result of a new `last_process_type(r)` helper (which picks the
  most recent item by `processEndTime`/`processStartTime`, falling back to list order).
- **Adapted `local/casecenter.py` `map_record()` to Case Center's new JSON shape.** The
  substatus moved into a `subStatus` object — `caseSubstatus` is gone; we now read
  `subStatus.transition` via a new `sub_transition(r)` helper that tolerates the object
  being missing, null, or the wrong type. The end-user fields moved to the top level: the
  board case's `requester` field is renamed **`user`** (now combines `userAccount` +
  `userName`), and `requesterDept` becomes **`userDept`** (from top-level `userDept` —
  the old `customField` block is gone). `reporterId` → **`reporter`** and `assigneeId` →
  **`assignee`** (both plain account ids at the top level now); their departments are
  derived from `processTimeline` by matching `processor` to the id and picking the
  latest item's `processorDeptName` (no direct `deptName` on the new payload). `Wait User`
  attaches `waitUser` only when its block is present and well-formed. The same field
  renames flowed through `local/persist.py` and `backend/merge.py` `CC_OWNED_FIELDS`,
  `prototype/app.js` (detail rows, table column header → "User", queue/board reads,
  `CC_OWNED_FIELDS` mirror), `prototype/data.js` seed cases (`requester:` → `user:`),
  and the test fixture in `prototype/tests/run.cjs`. 77/77 tests pass.

- **Switched the prototype skin from the Pastel CommuGround theme to the Forest variant.**
  Updated `prototype/styles.css` tokens to the Forest palette (page bg `#e8ece8`, deep-forest
  accent `#2e5942`/`#4e8063`/`#e3efe7`, light→dark green lifecycle column ramp, desaturated
  brick/amber/tan semantic pills) and swapped Plus Jakarta Sans + JetBrains Mono for
  Source Serif 4 + Libre Franklin + IBM Plex Mono via Google Fonts. Titles, page header,
  stat figures, column names, and modal/shift names are now set in Source Serif 4 700 per
  the formal-mode spec. Radii tightened ~3px across cards/pills/chips; brand and primary
  buttons use the green gradient `#2f6b46→#4e8063` with a green-tinted shadow. Prompt icon
  swatches re-mapped to Forest greens/brick. No markup, class hooks, behavior, or sidebar
  items were changed — only the theme.
- **CommuGround visual theme applied to the prototype (earlier today).** Reskinned
  `prototype/styles.css` and loaded Plus Jakarta Sans + JetBrains Mono via Google Fonts in
  `prototype/index.html` to match the Pastel `design_handoff_commuground` reference. Now
  superseded by the Forest skin above.

---

## 2026-06-08

### Added

- **"Waiting on user" panel on the case detail (from Case Center).** When a case is parked on the
  end user (Case Center substatus `Wait User`), the detail now shows the `subStatus` block — the
  wait **reason**, the **due action** and **due date** (with a *due in …* / *overdue by …* chip),
  the **last processor** (assignee · handler group · handler type), and the **transition** that
  parked it. `local/casecenter.py` gains `map_wait_user()` (reads `r.subStatus` →
  `reason / dueAction / dueDateTime / transition / transitionDateTime / lastProcessor.{assignee,
  handlerGrp, handlerType}`); `map_record` attaches it as `waitUser` only when
  `caseSubstatus == "Wait User"`. Treated as a Case Center–owned field (kept current on refresh)
  and seeded (overdue) on C-1046. The section is hidden for cases that aren't waiting on the user.
- **Process timeline on the case detail (from Case Center).** A new timeline shows Case Center's
  own per-stage processing log — each stage sized by its `processMinutes`, colored by the board
  status its Case Center status maps to, with a per-status legend, a total, and per-stage tooltips
  (processor, dept, status, start time). `local/casecenter.py` gains `map_process_timeline()` (it
  normalizes `r.processTimeline` items — `processorDeptName/processStartTime/caseStatus/
  processMinutes/caseSubstatus/processEndTime/processType/processor` — into the board shape and is
  exposed through `map_record`); `processTimeline` is treated as a Case Center–owned field, so a
  live refresh keeps it current. Seeded on two demo cases (C-1044, C-1045). The detail section is
  hidden for cases that have no process timeline.

### Fixed

- **Case Center link no longer disappears in live mode.** Since a page refresh no longer
  re-fetches, a case stored before `CASE_CENTER_BASE_URL` was configured kept its empty
  `caseLink` and rendered a blank link. The board now falls back to building the link from the
  case id + the base URL (`caseHref()`), and `serve.py`/`persist.py` expose that base as
  `window.CASE_CENTER_BASE_URL` in `data.js`. (One-time repair for already-stored cases: press
  **Refresh Existing**, which re-pulls with the base set and rewrites the links.)
- **Operator work now survives a page refresh in live mode.** Reloading the board no longer
  re-pulls Case Center and rebuilds the board (which could drop or reset a case you'd just
  assigned/moved). Live mode now adopts the persisted `data.js` store on load, so a refresh shows
  exactly what's saved. (See the matching *Changed* entry — Case Center is queried only via "Load
  New" / "Refresh Existing".)
- **Timeline timezones now line up.** Case Center timestamps that arrive without a timezone
  (process-timeline and Wait User times) were parsed in the viewer's local zone, so the Process
  timeline disagreed with the Ownership timeline (anchored on `createDateTime`, which carries
  `+00:00`). `local/casecenter.py` now normalizes every datetime it emits to explicit UTC
  (`iso_utc()` — Case Center stores GMT), so all timelines share one frame.

### Changed

- **A page refresh no longer pulls from Case Center — load on demand only.** In live mode the
  board now queries Case Center only when you press **Load New** or **Refresh Existing**; opening
  or reloading the page shows the cases already saved in `data.js`. (`boot()` enters live mode
  from the persisted store instead of auto-fetching.)
- **Rolled the demo calendar forward one week.** Seed data now centers on **W24 · June 8 – 14,
  2026** (`window.NOW` = `2026-06-12T13:00:00Z`): every case timestamp shifted +7 days, every
  `weekId` bumped +1, and the rolling 4-week window advanced (W24 current; W23/W22/W21 prior;
  the oldest week drops off). Coverage (statuses, flags, idle/SLA thresholds, stale handover,
  carry-over) is preserved.

### Internal

- **Fixed stale week labels in `data.js`.** The historical section comments (`W16/W17/W18`) and
  the carry-over note/history detail (`W18 → W19`) were several shifts out of date; they now
  match the actual `weekId`s (`W21/W22/W23`, carry-over `W23 → W24`).
- **Storage key bumped `v4 → v5 → v6`** for the new top-level `processTimeline` and `waitUser`
  fields on cases, so returning users don't load a stale localStorage shape. Added 4
  `processSegments` and 3 `waitUserDueMs` characterization tests — suite now at 74.
- **Pages deploy now triggers on `claude/charming-cray-ti71j0`** (added to the push branch list in
  `.github/workflows/pages.yml`).

## 2026-06-06

### Internal

- **Project rules for every Claude Code session.** Added a root `CLAUDE.md` (auto-loaded rulebook)
  and a scoped `backend/CLAUDE.md` (credentials live only on the ingestion side; `merge.py` field
  ownership; `DATABASE_URL` is the only DB switch). Extended the **Stop** release-note hook to cover
  `backend/` and `deploy/`, added a **Stop** `tests-before-finish` hook and a **PostToolUse**
  `rebundle-standalone` hook, and a `/ship` skill for the end-of-change ritual.

### Docs

- **Single source of truth for setup.** New `docs/SETUP.md` consolidates run instructions, Case
  Center credentials, and the full environment-variable table; the root/`local`/`backend` READMEs
  now link to it instead of duplicating. Consolidated all TODOs into `docs/improvement-plan.md`
  (new §5, absorbing the former `local/TODO-casecenter-mapping.md`).

## 2026-06-05

### Added

- **Reminder "at a specific time."** The *Remind me* modal now offers a time picker in addition to
  the relative presets — set a reminder to fire at a clock time (e.g. **05:30**), today or tomorrow
  if it's already past. A specific time wins over the preset when set.
- **Recycle bin for cases (4.4).** A 🗑 button on each Weekly-Archive row soft-deletes a case;
  a new **Recycle bin** page (`#/archive/bin`) lists deleted cases with time-remaining and offers
  **Restore** or a second-confirm **Delete forever**. Foolproof two-step delete (bin → permanent),
  binned cases hidden from the board/archive/stats/reminders, and auto-purge after 7 days.
  Persists in both demo (localStorage) and live mode.
- **Created-between load window (4.10).** "Load New" now takes two bounds — *Created between
  `[older]` and `[newer]` h ago* — so you can pull a band (e.g. created between 72h and 60h ago),
  not just "within N hours." Falls back to the single-bound form when the newer bound is 0.
- **Per-case and refresh-all live refresh (4.1).** A `⟳` button on each card and in the
  reading-panel/detail re-fetches one case from Case Center; a **Refresh Existing** toolbar button
  re-pulls every case on the board. Shown everywhere; degrades gracefully without a backend.
- **First-line handling clock + "Clock model" page (4.5, 4.6).** The case detail gains a fourth
  clock (time the first-line agent held the case directly); a new **Clock model** page
  (`#/clocks`) explains how each clock is calculated, with a live worked example.
- **First line can return a New case to the requester (4.9).** "Return to requester" is now
  available from the New status; Status Flow diagram and table updated to match.
- **Zero-dependency test harness.** `node prototype/tests/run.cjs` — 66 characterization tests
  covering the pure functions, action-handler outcomes, the live-merge/refresh logic, the recycle
  bin, and the load-window URL/validation. No npm, no framework.

### Fixed

- **Refresh no longer wipes your work on a case (client + server).** Re-fetching a case used to
  reset its status, FIT/HQ assignment, history, notes and clocks. Now a live refresh updates only
  Case Center–owned display fields and preserves everything operator-local — in the browser
  (`overlayLiveCase`) and on disk (`persist.py` overlay; operator saves stay authoritative).
- **Hard refresh no longer resets an assigned case to New.** `persist.py` had been overwriting the
  board status in `data.js` with the raw Case Center status on every fetch; it now preserves
  operator work across reloads.
- **First-line / triage time now correct for live cases.** Live cases arrive with no `created`
  event; the ownership timeline now anchors first-line at the create time, so assigning to FIT
  yields first-line time = *assign time − create time*.
- **Hardened the live-data load.** Malformed Case Center records (missing id / not an object) are
  dropped with a warning instead of becoming ghost cards or corrupting the merge.
- **serve.py sends the `/api/cases` response before writing `data.js`,** so a slow disk write can't
  delay or interrupt delivery (shrinks the harmless "client closed the connection" notice).

### Changed

- **Sanity Check counts as requester time (4.8).** It's no longer part of first-line handling; the
  First-line clock is triage-only and the timeline/Clock-model treat Sanity Check as "with
  requester." (SLA keeps running through Sanity Check.)
- **Refresh buttons are always visible** (board, Pages demo, and `file://`), degrading gracefully
  with a "no backend" toast when there's nothing to reach.
- **"Load" renamed to "Load New"** to distinguish loading newly-created cases from refreshing
  existing ones (4.2).
- **Live-fetch timeout default raised to 5 minutes** (`LIVE_FETCH_TIMEOUT_MS`); still overridable
  via `?liveTimeout=SECONDS`.

### Internal

- **P0/P1 code-review fixes:** validated live payloads, consolidated timer constants into `CONFIG`,
  null-safe modal reads via `fieldVal`, and a `logHistory` helper replacing repeated history-push
  boilerplate — all under the new test net.
- **CI:** this branch now deploys to GitHub Pages.

### Docs

- **Improvement plan & backlog** (`docs/improvement-plan.md`): code-review roadmap plus a tracked
  feature backlog (4.1–4.10) with per-item plans and progress.
- **README local-setup checklist:** what to edit after pulling locally — `fetch_raw()`,
  `secrets.local.json`, and the virus-scanned `index.html` / `standalone.html`.

---

## 2026-06-04

### Added

- **Configurable live-fetch timeout** — URL parameter plus an editable default.

### Fixed

- **serve.py ignores client-aborted connections** (no traceback spam) and sends strong no-cache
  headers so the board files are never served stale / 304'd.
- **`fetch_cases` tolerates a full-response shape** (unwraps common envelope keys) and logs the
  mapped case count.

### Changed

- **Live-mode board banner** so the board is never silently empty when running on Case Center data.

---

## How to regenerate `standalone.html`

The modular sources under `prototype/` are the source of truth. After any edit:

```bash
node prototype/bundle.mjs
```

The Pages workflow runs this automatically on deploy.
