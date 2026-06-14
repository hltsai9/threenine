# Route Board — dot = current Case Center location, Track Status = desired

**Date:** 2026-06-14
**Status:** Approved (pending spec review)
**Area:** `prototype/` (front-end SPA) — Route Board visualization + seed data

## Problem

The Route Board dot is meant to show **where a case actually is**, but today
`caseStation()` (a) matches the specific owner-team name from `owners.js` and (b) lets the
operator's **Track Status** *pin* the dot (e.g. Sanity Check / Closed force it to **User**).
That conflates two different things and makes the dot lie about the real location. The seed
data is also unrealistic (assignee departments are specific desk names, not the broad
departments a real Case Center record carries).

## The model (the key idea)

Two distinct "assignees":

| Concept | Source | Meaning | Shows as |
| --- | --- | --- | --- |
| **Current assignee** | Case Center (`assigneeDept` + latest `processType`) | where the case **is** right now | the **dot's station** |
| **Desired assignee** | operator **Track Status** (+ suggested time) | where 1st line **intends** to send it | the **animation target** + cue |

The **animation is the gap** between current and desired — a cue that 1st line has a pending
action. The operator resolves it by doing the work in Case Center **and** updating the Track
Status + writing a handover note here; on the next CC refresh the current assignee catches up
and the dot parks at the new station.

**Therefore: Track Status must never set the dot's station.** Its only jobs are the animation
target and the visual decoration.

## Configuration (file-based, in `owners.js`)

Two new lists live in `prototype/owners.js` next to `window.OWNERS`, with placeholder values
for the operator to fill at go-live (departments are NOT literally "Site IT"/"HQ IT"):

```js
// Departments (from the Case Center assignee record) that mean the case is on the Core
// Team / 1st Line side. Disambiguated by processType below. Fill in your real dept name(s).
window.CC_CORE_DEPARTMENTS = ['Site IT'];

// Departments that mean the case is on HQ. There can be several. Fill in your real names.
window.CC_HQ_DEPARTMENTS = ['HQ Identity', 'HQ Mobile'];
```

Matching is case-insensitive exact match against `case.assigneeDept`.

> Out of scope: moving `owners.js` / `shifts.js` (and these dept lists) into the database so
> edits are shared across operators. Only **cases** are DB-backed today; owners/shifts stay
> file-based (edit + redeploy, or per-browser in-app edit). DB-backing them is a separate step.

### ProcessType values (literal, from Case Center)

`"1st  Line"` (two spaces — keep verbatim), `"Service Team"`, `"User"`, and `"Unknown"`
(appears between stages and at case creation).

## Position logic — `caseStation()` rewrite

```
pt = processType of the latest process-timeline entry (by processStartTime),
     skipping "Unknown"; if there is no non-Unknown entry → treat as "1st  Line".
dept = case.assigneeDept

1. pt == "User"                         → User        (wins everything)
2. dept ∈ CC_CORE_DEPARTMENTS:
       pt == "Service Team"             → Core Team
       pt == "1st  Line"                → 1st Line
       (any other pt while in a Core dept → fall through to rule 4)
3. dept ∈ CC_HQ_DEPARTMENTS             → HQ
4. anything unrecognised                → 1st Line
```

Rules are evaluated top to bottom; the first match wins. A Core-dept case whose latest
non-Unknown processType is neither `Service Team` nor `1st  Line` falls through to rule 4
(→ 1st Line).

- The `pinTo` override (Sanity Check / Closed → User) is **removed** from station resolution.
- `deptToRoleRaw()` (owner-team-name matching) is **replaced** for Route-Board purposes by the
  dept-list + processType rules above. `owners.js` `route_role` and the owner directory remain
  for the assignment/routing UI elsewhere — only the Route Board station changes.

## Track Status = decoration + animation target only

- **Moving**: a Track Status with a scheduled target (`scheduled.to` + time: Sun 17:30 /
  next-day 17:30 / same-day 09:00) animates the dot from its **current** station toward the
  desired one. Origin is now the CC-derived `caseStation(c)`, not a pinned guess.
- **Watch**: `escalated_to_hq` / `need_to_contact_user` keep the dashed ring/pulse decoration.
- **Sanity**: `sanity_check` keeps its tag + collapsible grouping decoration.
- None of these change the station.

## Station rendering, incl. the new 1st-Line dot

Stations on the strip: **User · Core Team · HQ** (existing), plus **1st Line** rendered specially:

- **1st-Line case** → a **static dot positioned between the User and Core Team stations**, with
  **two dashed, animated arrows** from the dot: one pointing left (→ User), one right
  (→ Core Team). This is the "at triage, could go either way" cue.
- **Interaction with a desired Track Status** (decision for review): if a 1st-Line case also
  has a Track Status with a scheduled target, the **directional moving animation toward that
  target takes precedence** over the bidirectional dashed arrows (the operator has expressed an
  intent). A 1st-Line case with no actionable desired (untracked, or just created) shows the
  bidirectional dashed arrows.

## Seed data reshape (`data.js`)

- Each case's assignee carries a **department** drawn from the configurable Core/HQ values
  (demo examples: `Site IT`, `HQ Identity`, `HQ Mobile`) — not the specific `owners.js` desk
  names. The mapper continues to derive `assigneeDept` from the timeline, so the assignee's
  current-stage `processorDeptName` should be one of those department values.
- Process timelines carry realistic `processType` transitions, including **`Unknown`** at
  creation and between stages, ending on the type that reflects the current location
  (`1st  Line` / `Service Team` / `User`, or an HQ-dept stage for HQ cases).
- Track Status (desired) remains in `window.SEED_AGENT_LAYER`.
- Keep coverage across all stations and decorations: User, Core Team, HQ, and **1st Line**
  (with and without a desired Track Status), plus watch and sanity decorations.

## Components affected

- `prototype/owners.js` — add `CC_CORE_DEPARTMENTS`, `CC_HQ_DEPARTMENTS`.
- `prototype/app.js` — rewrite `caseStation()`; add a "latest non-Unknown processType" helper;
  remove `pinTo` from station resolution; add the 1st-Line lane to `_classifyRouteRow()` and a
  renderer for the static dot + bidirectional dashed arrows; route the moving animation origin
  through the new `caseStation()`.
- `prototype/styles.css` — styles for the 1st-Line dot and the two dashed animated arrows.
- `prototype/data.js` — reshape the seed per above (regenerate via the `generate-data-js` skill).
- `prototype/tests/run.cjs` — tests for `caseStation()` across every rule (User-wins, Core
  Service-Team vs 1st-Line, HQ dept, Unknown-skip, unrecognised fallback) and that Track Status
  no longer changes the station.
- `docs/RELEASE_NOTES.md` — entry; rerun `node prototype/bundle.mjs`.

## Out of scope

- DB-backed owners/shifts/dept-list (separate future step).
- Backend `casecenter.py` mapping changes (it already supplies `assigneeDept` + `processTimeline`;
  the new rules are front-end only). Keep `CC_OWNED_FIELDS` parity if any field is added.
- Per-operator identity / auth (separate track).

## Testing

- Pure-function tests for `caseStation()` covering each branch + Unknown-skipping + fallback.
- A test asserting a `sanity_check` / `case_closed` case is NOT pinned to User (station = CC).
- Visual sanity: seed includes at least one case per station incl. a 1st-Line case with the
  bidirectional arrows and a 1st-Line case with a desired Track Status (directional).
- `node prototype/tests/run.cjs` green; rebundle.
