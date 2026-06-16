# Route Board CC-Position Implementation Plan

> **Status: ✅ Implemented & shipped (2026-06-14).** All eight tasks landed — `caseStation`
> derives the current station from Case Center fields (no Track-Status pin), the 1st-Line lane
> and bidirectional arrows render, and the seed was reshaped. Checkboxes below are marked `[x]`.
> Kept for historical reference. No unapplicable items — the plan shipped in full.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the Route Board dot show a case's real Case Center location (from `assigneeDept` + latest `processType`), with Track Status only decorating/animating toward the *desired* location — never moving the dot.

**Architecture:** Front-end only (`prototype/`). Configurable department lists in `owners.js`; a rewritten `caseStation()` resolves the station from CC fields; the Route Board row renderers position every dot via `caseStation()`; a new "1st Line" station renders a static dot between User and Core with two dashed animated arrows. Seed data reshaped to realistic CC records.

**Tech Stack:** Zero-dependency vanilla JS + CSS. Tests via `node prototype/tests/run.cjs` (pure-function harness that exposes top-level `app.*` functions). Rebundle via `node prototype/bundle.mjs`.

**Spec:** `docs/superpowers/specs/2026-06-14-route-board-cc-position-design.md`

---

## File Structure

- `prototype/owners.js` — add `window.CC_CORE_DEPARTMENTS`, `window.CC_HQ_DEPARTMENTS`.
- `prototype/app.js` — `latestProcessType()` helper, `deptInList()` helper, `caseStation()` rewrite, `ROUTE_STATION_POS['1st Line']`, reposition stay/watch/sanity dots, `_classifyRouteRow()` + `_renderFirstLineRow()` + `renderRouteBoardStrip()` firstline bucket.
- `prototype/styles.css` — 1st-Line dot + dashed bidirectional arrows.
- `prototype/data.js` — reshape seed (via `generate-data-js` skill).
- `prototype/tests/run.cjs` — unit tests for the new logic + renderers.
- `docs/RELEASE_NOTES.md` — entry; then rebundle.

---

### Task 1: Department-list config in `owners.js`

**Files:**
- Modify: `prototype/owners.js` (append after the `window.OWNERS = {...}` block)
- Test: `prototype/tests/run.cjs`

- [x] **Step 1: Write the failing test**

Add near the seed-sanity tests in `run.cjs`:

```js
/* ---------- Route Board dept-list config ---------- */
test('owners: CC dept lists are non-empty arrays', () => {
  ok(Array.isArray(app.CC_CORE_DEPARTMENTS) && app.CC_CORE_DEPARTMENTS.length > 0, 'core list');
  ok(Array.isArray(app.CC_HQ_DEPARTMENTS) && app.CC_HQ_DEPARTMENTS.length > 0, 'hq list');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node prototype/tests/run.cjs`
Expected: FAIL — `core list` (CC_CORE_DEPARTMENTS undefined).

- [x] **Step 3: Add the config to `owners.js`**

Append to the end of `prototype/owners.js`:

```js
// ---- Route Board department → station config --------------------------------
// The dot on the Hand-off Route Board shows where a case CURRENTLY is, derived from the
// Case Center assignee's DEPARTMENT plus the latest process-timeline processType. Fill these
// in with your real Case Center department names at go-live (these demo values match data.js).
//   - A dept in CC_CORE_DEPARTMENTS means Core Team / 1st Line (processType disambiguates).
//   - A dept in CC_HQ_DEPARTMENTS means HQ. There can be several.
// Matching is case-insensitive exact match against a case's assigneeDept.
window.CC_CORE_DEPARTMENTS = ['Site IT'];
window.CC_HQ_DEPARTMENTS = ['HQ Identity', 'HQ Mobile'];
```

- [x] **Step 4: Run test to verify it passes**

Run: `node prototype/tests/run.cjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add prototype/owners.js prototype/tests/run.cjs
git commit -m "feat(route-board): configurable CC department lists in owners.js"
```

---

### Task 2: `latestProcessType()` helper

**Files:**
- Modify: `prototype/app.js` (add near `caseStation`, before it)
- Test: `prototype/tests/run.cjs`

- [x] **Step 1: Write the failing test**

```js
/* ---------- latestProcessType (skips Unknown) ---------- */
const latestProcessType = app.latestProcessType;
test('latestProcessType: returns latest non-Unknown by start time', () => {
  eq(latestProcessType({ processTimeline: [
    { processType: '1st  Line', processStartTime: iso(3 * HOUR) },
    { processType: 'Service Team', processStartTime: iso(1 * HOUR) },
    { processType: 'Unknown', processStartTime: iso(0) },
  ] }), 'Service Team');
});
test('latestProcessType: empty / all-Unknown / missing → "1st  Line"', () => {
  eq(latestProcessType({ processTimeline: [] }), '1st  Line');
  eq(latestProcessType({ processTimeline: [{ processType: 'Unknown', processStartTime: iso(0) }] }), '1st  Line');
  eq(latestProcessType({}), '1st  Line');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node prototype/tests/run.cjs`
Expected: FAIL — `app.latestProcessType is not a function`.

- [x] **Step 3: Implement the helper**

Add to `prototype/app.js` immediately before `function caseStation(c)`:

```js
// The latest process-timeline processType that drives a case's CURRENT station. "Unknown"
// appears transiently and at creation, so it's skipped. Falls back to "1st  Line" (two
// spaces — the literal Case Center value) when there's no usable entry.
function latestProcessType(c) {
  const tl = Array.isArray(c && c.processTimeline) ? c.processTimeline : [];
  const known = tl
    .filter(e => e && e.processType && e.processType !== 'Unknown')
    .slice()
    .sort((a, b) => new Date(a.processStartTime || 0) - new Date(b.processStartTime || 0));
  return known.length ? known[known.length - 1].processType : '1st  Line';
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node prototype/tests/run.cjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add prototype/app.js prototype/tests/run.cjs
git commit -m "feat(route-board): latestProcessType helper (skips Unknown)"
```

---

### Task 3: Rewrite `caseStation()` (CC-derived, no Track-Status pin)

**Files:**
- Modify: `prototype/app.js` (`caseStation` body; add `deptInList` + `STATION_1ST_LINE` constant)
- Test: `prototype/tests/run.cjs`

- [x] **Step 1: Write the failing tests**

```js
/* ---------- caseStation (dot = current CC location) ---------- */
const caseStation = app.caseStation;
// Pin the dept lists for deterministic tests.
app.CC_CORE_DEPARTMENTS = ['Site IT'];
app.CC_HQ_DEPARTMENTS = ['HQ Identity', 'HQ Mobile'];
const stationCase = (dept, pt, extra) => Object.assign({
  assigneeDept: dept,
  processTimeline: [{ processType: pt, processStartTime: iso(1 * HOUR) }],
}, extra || {});

test('caseStation: latest processType User wins everything', () =>
  eq(caseStation(stationCase('HQ Identity', 'User')), 'User'));
test('caseStation: Core dept + Service Team → Core Team', () =>
  eq(caseStation(stationCase('Site IT', 'Service Team')), 'Core Team'));
test('caseStation: Core dept + 1st Line → 1st Line', () =>
  eq(caseStation(stationCase('Site IT', '1st  Line')), '1st Line'));
test('caseStation: HQ dept → HQ', () =>
  eq(caseStation(stationCase('HQ Mobile', 'Service Team')), 'HQ'));
test('caseStation: unrecognised dept → 1st Line', () =>
  eq(caseStation(stationCase('Marketing', 'Service Team')), '1st Line'));
test('caseStation: Unknown is skipped when resolving', () =>
  eq(caseStation({ assigneeDept: 'Site IT', processTimeline: [
    { processType: 'Service Team', processStartTime: iso(2 * HOUR) },
    { processType: 'Unknown', processStartTime: iso(1 * HOUR) },
  ] }), 'Core Team'));
test('caseStation: Track Status no longer pins the dot to User', () =>
  eq(caseStation(stationCase('HQ Identity', 'Service Team', { trackStatus: 'sanity_check' })), 'HQ'));
```

- [x] **Step 2: Run test to verify it fails**

Run: `node prototype/tests/run.cjs`
Expected: FAIL — current `caseStation` returns `User` for the sanity_check case (pinTo) and uses team-name matching.

- [x] **Step 3: Rewrite `caseStation` and add `deptInList`**

Replace the existing `function caseStation(c) {...}` in `prototype/app.js` with:

```js
const STATION_1ST_LINE = '1st Line';
function deptInList(dept, list) {
  if (!dept || !Array.isArray(list)) return false;
  const d = String(dept).toLowerCase();
  return list.some(x => String(x).toLowerCase() === d);
}
// CURRENT station of a case, from Case Center only (assigneeDept + latest processType).
// Track Status (the DESIRED location) must NOT influence this — see the design spec.
function caseStation(c) {
  const pt = latestProcessType(c);
  if (pt === 'User') return 'User';                                  // returned-to-user wins
  const dept = c && c.assigneeDept;
  if (deptInList(dept, window.CC_CORE_DEPARTMENTS)) {                // Core side
    if (pt === 'Service Team') return 'Core Team';
    return STATION_1ST_LINE;                                         // 1st Line / any other pt
  }
  if (deptInList(dept, window.CC_HQ_DEPARTMENTS)) return 'HQ';       // HQ side
  return STATION_1ST_LINE;                                           // unrecognised → triage
}
```

Note: leave the existing `deptToRoleRaw()` function in place — it is still used by the owner directory / assignment UI; only `caseStation` stops calling it.

- [x] **Step 4: Run test to verify it passes**

Run: `node prototype/tests/run.cjs`
Expected: PASS (all caseStation tests).

- [x] **Step 5: Commit**

```bash
git add prototype/app.js prototype/tests/run.cjs
git commit -m "feat(route-board): caseStation derives current station from CC, drops Track-Status pin"
```

---

### Task 4: Add the 1st-Line station position; position stay/watch/sanity dots via `caseStation`

**Files:**
- Modify: `prototype/app.js` (`ROUTE_STATION_POS`; `_renderStayRow`, `_renderWatchRow`, `_renderSanitySubRow`)
- Test: `prototype/tests/run.cjs`

- [x] **Step 1: Write the failing tests**

```js
/* ---------- Route Board dot positions follow caseStation ---------- */
test('ROUTE_STATION_POS: 1st Line sits between User and Core', () => {
  ok(app.ROUTE_STATION_POS['1st Line'] > app.ROUTE_STATION_POS['User'], 'right of User');
  ok(app.ROUTE_STATION_POS['1st Line'] < app.ROUTE_STATION_POS['Core Team'], 'left of Core');
});
test('stay row dot is placed at the case station (HQ), not hard-coded User', () => {
  const c = { id: 'C-STAY', subject: 's', assigneeDept: 'HQ Identity',
    processTimeline: [{ processType: 'Service Team', processStartTime: iso(HOUR) }] };
  const html = app._renderStayRow(c, 0);
  ok(html.includes('left:88%'), 'stay dot at HQ (88%)');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node prototype/tests/run.cjs`
Expected: FAIL — `ROUTE_STATION_POS['1st Line']` undefined; stay row still hard-codes `left:12%`.

- [x] **Step 3: Implement**

In `prototype/app.js`, change `ROUTE_STATION_POS`:

```js
const ROUTE_STATION_POS = { 'User': 12, '1st Line': 31, 'Core Team': 50, 'HQ': 88 };
```

Replace `_renderStayRow` body's hard-coded `12%` with the case's station pct:

```js
function _renderStayRow(c, top) {
  const sel = STATE.kanbanSelected === c.id ? ' rb-row-selected' : '';
  const pct = ROUTE_STATION_POS[caseStation(c)] ?? 12;
  return `
    <div class="rb-row rb-row-stay${sel}" style="top:${top}px;" data-case-id="${c.id}" data-action="select-case" title="${escapeHtml(c.id)} · ${escapeHtml(c.subject)}">
      <div class="rb-stay-dot" style="left:${pct}%;"></div>
      <div class="rb-stay-id" style="left:calc(${pct}% + 14px);">${escapeHtml(c.id)} · stays</div>
    </div>
  `;
}
```

In `_renderWatchRow`, replace the station/pct derivation (the `const station = def.watch || 'HQ';` and `const pct = ROUTE_STATION_POS[station] ?? 88;` lines) with the CC station:

```js
  const station = caseStation(c);
  const pct = ROUTE_STATION_POS[station] ?? 88;
```

(The `dotColor` line that checks `station === 'User'` keeps working; non-User stations get the HQ colour `#8C4A2F`.)

In `_renderSanitySubRow`, replace both hard-coded `12%` with the case station:

```js
function _renderSanitySubRow(c, top) {
  const sel = STATE.kanbanSelected === c.id ? ' rb-row-selected' : '';
  const pct = ROUTE_STATION_POS[caseStation(c)] ?? 12;
  return `
    <div class="rb-row rb-row-sanity-sub${sel}" style="top:${top}px;" data-case-id="${c.id}" data-action="select-case" title="${escapeHtml(c.id)} · ${escapeHtml(c.subject)}">
      <div class="rb-sanity-sub-dot" style="left:${pct}%;"></div>
      <div class="rb-sanity-sub-id" style="left:calc(${pct}% + 14px);">${escapeHtml(c.id)} · ${escapeHtml(c.subject)}</div>
    </div>
  `;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node prototype/tests/run.cjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add prototype/app.js prototype/tests/run.cjs
git commit -m "feat(route-board): position stay/watch/sanity dots at the CC station; add 1st-Line position"
```

---

### Task 5: 1st-Line lane — classify + render the static dot with bidirectional arrows

**Files:**
- Modify: `prototype/app.js` (`_classifyRouteRow`, new `_renderFirstLineRow`, `renderRouteBoardStrip`)
- Test: `prototype/tests/run.cjs`

- [x] **Step 1: Write the failing tests**

```js
/* ---------- 1st-Line lane ---------- */
test('_classifyRouteRow: untracked 1st-Line case → firstline', () => {
  const c = { id: 'C-FL', subject: 's', assigneeDept: 'Site IT',
    processTimeline: [{ processType: '1st  Line', processStartTime: iso(HOUR) }] };
  eq(app._classifyRouteRow(c), 'firstline');
});
test('_classifyRouteRow: 1st-Line case WITH a scheduled desired → moving', () => {
  const c = { id: 'C-FLM', subject: 's', assigneeDept: 'Site IT', agentStatus: 'queued',
    trackStatus: 'escalate_to_core',
    processTimeline: [{ processType: '1st  Line', processStartTime: iso(HOUR) }] };
  eq(app._classifyRouteRow(c), 'moving');
});
test('_renderFirstLineRow: static dot at 1st-Line pct + two dashed arrows', () => {
  const c = { id: 'C-FL', subject: 's', assigneeDept: 'Site IT',
    processTimeline: [{ processType: '1st  Line', processStartTime: iso(HOUR) }] };
  const html = app._renderFirstLineRow(c, 0);
  ok(html.includes('rb-row-firstline'), 'firstline row class');
  ok(html.includes('left:31%'), 'dot at 1st-Line pct');
  ok(html.includes('rb-fl-arrow-left') && html.includes('rb-fl-arrow-right'), 'both arrows');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node prototype/tests/run.cjs`
Expected: FAIL — `_classifyRouteRow` returns `stay` for the firstline case; `app._renderFirstLineRow is not a function`.

- [x] **Step 3: Implement classification + renderer + bucket**

Replace `_classifyRouteRow` in `prototype/app.js`:

```js
function _classifyRouteRow(c) {
  const ts = caseTrackStatus(c);
  if (ts === 'sanity_check') return 'sanity';
  if (scheduledHandoff(c)) return 'moving';   // a desired handoff → directional animation
  if (ts === 'escalated_to_hq' || ts === 'need_to_contact_user') return 'watch';
  if (caseStation(c) === STATION_1ST_LINE) return 'firstline';   // at triage, no firm intent
  return 'stay';
}
```

Add the renderer next to the other `_render*Row` functions:

```js
// 1st-Line: the case is at triage — could move to User or to Core. A static dot between the
// two stations with a dashed animated arrow pointing each way (the "decide where it goes" cue).
function _renderFirstLineRow(c, top) {
  const sel = STATE.kanbanSelected === c.id ? ' rb-row-selected' : '';
  const pct = ROUTE_STATION_POS[STATION_1ST_LINE];
  return `
    <div class="rb-row rb-row-firstline${sel}" style="top:${top}px;" data-case-id="${c.id}" data-action="select-case" title="${escapeHtml(c.id)} · ${escapeHtml(c.subject)}">
      <div class="rb-fl-arrow rb-fl-arrow-left"  style="left:${pct}%;"></div>
      <div class="rb-fl-arrow rb-fl-arrow-right" style="left:${pct}%;"></div>
      <div class="rb-fl-dot" style="left:${pct}%;"></div>
      <div class="rb-fl-id"  style="left:calc(${pct}% + 16px);">${escapeHtml(c.id)} · 1st line</div>
    </div>
  `;
}
```

In `renderRouteBoardStrip`, add the bucket. Change the declaration line:

```js
  const moving = [], watch = [], stay = [], sanity = [], firstline = [];
```

Add a case to the switch:

```js
      case 'firstline': firstline.push(c); break;
```

And lay the firstline rows out after the `watch` loop and before `stay` (row height 56):

```js
  for (const c of firstline) { segments.push(_renderFirstLineRow(c, y)); y += 56; }
```

- [x] **Step 4: Run test to verify it passes**

Run: `node prototype/tests/run.cjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add prototype/app.js prototype/tests/run.cjs
git commit -m "feat(route-board): 1st-Line lane — static dot + bidirectional dashed arrows"
```

---

### Task 6: CSS for the 1st-Line dot and dashed arrows

**Files:**
- Modify: `prototype/styles.css` (near the other `.rb-*` rules)

- [x] **Step 1: Add the styles**

Append after the existing `.rb-stay-*` rules in `prototype/styles.css`:

```css
/* 1st-Line lane: static dot between User and Core, dashed arrow each way. */
.rb-row-firstline { height: 56px; }
.rb-fl-dot {
  position: absolute; top: 50%; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px;
  border-radius: 50%; background: #6b7a72; box-shadow: 0 0 0 1.5px #6b7a72;
}
.rb-fl-id {
  position: absolute; top: 50%; transform: translateY(-50%);
  font-family: var(--font-mono); font-size: 11px; color: var(--text-faint-2); white-space: nowrap;
}
.rb-fl-arrow {
  position: absolute; top: 50%; height: 0; border-top: 1.5px dashed #9aa8a0;
  width: 15px; opacity: .9;
}
.rb-fl-arrow-left  { margin-top: -0.75px; transform: translateX(-21px); animation: rb-fl-pull-left 1.6s ease-in-out infinite; }
.rb-fl-arrow-right { margin-top: -0.75px; transform: translateX(6px);   animation: rb-fl-pull-right 1.6s ease-in-out infinite; }
.rb-fl-arrow-left::before  { content: ''; position: absolute; left: -1px; top: -3px; border: 3px solid transparent; border-right-color: #9aa8a0; }
.rb-fl-arrow-right::after  { content: ''; position: absolute; right: -1px; top: -3px; border: 3px solid transparent; border-left-color: #9aa8a0; }
@keyframes rb-fl-pull-left  { 0%,100% { transform: translateX(-21px); } 50% { transform: translateX(-25px); } }
@keyframes rb-fl-pull-right { 0%,100% { transform: translateX(6px); }   50% { transform: translateX(10px); } }
```

(The global `@media (prefers-reduced-motion: reduce)` rule already neutralises these animations.)

- [x] **Step 2: Rebundle and eyeball**

Run: `node prototype/bundle.mjs`
Then open `prototype/index.html` (or `standalone.html`) and confirm a 1st-Line case shows a grey dot ~⅓ across with a dashed arrow pulsing toward User and toward Core.

- [x] **Step 3: Commit**

```bash
git add prototype/styles.css prototype/standalone.html
git commit -m "style(route-board): 1st-Line dot + dashed bidirectional arrows"
```

---

### Task 7: Reshape seed data for realism

**Files:**
- Modify: `prototype/data.js` (regenerate via the `generate-data-js` skill — do NOT hand-edit)

- [x] **Step 1: Invoke the seed skill**

Use the `generate-data-js` skill with this intent: keep raw-CC shape (`CASES_RAW_CC`) and ~38 cases, but make each case's assignee department one of the configured demo values (`Site IT` for Core/1st-line cases; `HQ Identity` / `HQ Mobile` for HQ cases), set `processTimeline` processTypes to realistic transitions — **`Unknown` at creation**, then `1st  Line` (two spaces) / `Service Team` / `User` — ending on the type that reflects the case's current station. Ensure coverage includes: at least 3 cases that resolve to **1st Line** (one untracked → bidirectional arrows, one with a `escalate_to_core` Track Status → directional moving), cases at User / Core Team / HQ, and the existing watch + sanity Track Status picks in `SEED_AGENT_LAYER`.

- [x] **Step 2: Verify the seed maps to the expected stations**

Run:

```bash
node -e '
const { loadPrototype } = require("./prototype/tests/load-prototype.cjs");
const app = loadPrototype();
const f = app.CASES_RAW_CC ? "caseId" : "id";
const cases = app.CASES.map(r => app.caseById(String(r[f]))).filter(Boolean);
const tally = cases.reduce((m,c)=>{const s=app.caseStation(c);m[s]=(m[s]||0)+1;return m;},{});
console.log("station tally:", JSON.stringify(tally));
'
```

Expected: a spread including `"1st Line"`, `"Core Team"`, `"HQ"`, and `"User"` — non-zero each (confirms the dept + processType data drives positions).

- [x] **Step 3: Run tests + rebundle**

Run: `node prototype/tests/run.cjs` (Expected: PASS) then `node prototype/bundle.mjs`.

- [x] **Step 4: Commit**

```bash
git add prototype/data.js prototype/standalone.html
git commit -m "data: reshape seed with realistic CC departments + processType transitions"
```

---

### Task 8: Release notes, full verification, finalize

**Files:**
- Modify: `docs/RELEASE_NOTES.md`

- [x] **Step 1: Add the release note** under today's date in `docs/RELEASE_NOTES.md`:

```markdown
### Changed (Route Board — dot shows the real Case Center location)

- The Route Board dot now reflects a case's **current** Case Center location
  (`assigneeDept` + latest non-`Unknown` `processType`) via configurable
  `CC_CORE_DEPARTMENTS` / `CC_HQ_DEPARTMENTS` lists in `owners.js`. Track Status
  is now strictly the **desired** location — it decorates and animates toward the
  target but never moves the dot (the Sanity/Closed `pinTo` override is gone).
- New **1st Line** position: a static dot between User and Core with a dashed
  animated arrow each way. Stay/watch/sanity dots now sit at the case's real station.
```

- [x] **Step 2: Full test + bundle sync check**

Run:
```bash
node prototype/tests/run.cjs        # Expected: all PASS
node prototype/bundle.mjs           # rebuild standalone
git diff --quiet prototype/standalone.html && echo "bundle in sync" || echo "standalone changed — staged below"
```

- [x] **Step 3: Commit**

```bash
git add docs/RELEASE_NOTES.md prototype/standalone.html
git commit -m "docs: release note for Route Board CC-position change"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** dept-list config (Task 1) ✓; latest-non-Unknown processType (Task 2) ✓; caseStation rules incl. User-wins, Core+processType, HQ dept, Unknown-skip, fallback, no pinTo (Task 3) ✓; dot = CC for stay/watch/sanity + 1st-Line position (Task 4) ✓; 1st-Line lane render + classify, moving-takes-precedence interaction (Task 5) ✓; 1st-Line CSS (Task 6) ✓; seed reshape incl. Unknown + 1st-Line coverage (Task 7) ✓; release note + rebundle (Task 8) ✓.
- **Placeholders:** none — all steps carry real code/commands.
- **Type/name consistency:** `STATION_1ST_LINE` ('1st Line'), `ROUTE_STATION_POS['1st Line']`, `_renderFirstLineRow`, `rb-row-firstline` / `rb-fl-*` used consistently across tasks and CSS; `latestProcessType` / `deptInList` / `caseStation` signatures match their call sites.
