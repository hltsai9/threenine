---
name: generate-data-js
description: Generate or refresh prototype/data.js (seed data for the Case Tracker prototype). Use when the user asks to change the demo data — shift the calendar, add cases, rename operators, retune SLA scenarios, or rebuild data.js from scratch. Produces a well-formed file the SPA can consume without any other code changes.
---

# Generate `prototype/data.js`

`prototype/data.js` is the seed dataset the SPA boots from. It declares everything via `window.*` globals (no modules, no build step). After editing it you **must** rerun `node prototype/bundle.mjs` so `prototype/standalone.html` picks up the change.

## File contract

The file must define these globals, in this order:

| Global | Type | Purpose |
| --- | --- | --- |
| `window.NOW` | `Date` | Frozen "now" the app uses for SLA math, idle clocks, office-hours coloring. Pick a wall-clock time on the demo day. |
| `window.THRESHOLDS` | object | `fitIdleHours`, `hqIdleHours`, `approachingSlaHours`, `shiftEndingSoonMinutes`. |
| `window.OPERATORS` | array | `{ id, name, shift }`. Shift must be `'Day'` or `'Night'`. |
| `window.OWNERS` | `{ fit: [...], hq: [...] }` | FIT desks (Phoenix TZ) and HQ teams (Taipei TZ). |
| `window.CURRENT_OPERATOR_ID` | string | Must match an id in `OPERATORS`. |
| `window.CURRENT_SHIFT` | object | `{ name, endsAtUtc, date }`. |
| `window.CURRENT_WEEK` | object | `{ id, label, startsAt }`. |
| `window.WEEKS` | array | Past + current ISO weeks. Mark the current one with `isCurrent: true`. |
| `window.SHIFTS` | array | `[ { name: 'Day', hoursUtc, operatorIds }, { name: 'Night', ... } ]`. |
| `window.CASES` | array | The case records — see schema below. |

## Conventions (do not break)

- **All timestamps are ISO UTC** (`'2026-06-05T13:00:00Z'`). Never local time.
- **Operator IDs**: `op-da`, `op-na`, `op-db`, `op-nb` (Day-A / Night-A / Day-B / Night-B). Names follow the form `'Mia (DA)'`, `'Ren (NA)'`, etc.
- **FIT TZ**: all FIT desks use `tz: 'America/Phoenix'`, office `'08:00–17:00'`.
- **HQ TZ**: all HQ teams use `tz: 'Asia/Taipei'`, office `'09:00–18:00'`.
- **Case IDs**: `C-1041` upward for the current week; older closed cases use lower numbers (`C-0998`, `C-1015`, `C-1030`...).
- **`weekId`** on every case. Must reference a `WEEKS[].id`.
- **Status enum**: `new | with_fit | with_hq | sanity_check | returned_to_requester | resolved | closed | cancelled`.
- **Flags**: `weekend`, `escalated`, `scheduled_ooc`. Use the array form (`flags: []` if none).
- **Routing invariants**:
  - `status: 'new'` ⇒ `fitId: null, hqId: null, currentOwner: null`.
  - `status: 'with_fit'` ⇒ `fitId` set, `hqId: null`, `currentOwner: 'fit'`.
  - `status: 'with_hq'` ⇒ both `fitId` and `hqId` set, `currentOwner: 'hq'`.
  - `status: 'sanity_check'` ⇒ owner stays whoever pushed the resolution (`'hq'` for escalated cases, `'fit'` for FIT-resolved ones).
  - `status: 'returned_to_requester'` ⇒ `slaPaused: true`, `currentOwner: null`, `holdStartedAt: null`.
  - `status: 'closed' | 'cancelled'` ⇒ `currentOwner: null`, `holdStartedAt: null`.

## Case schema

```js
{
  id: 'C-1042',                         // string, unique
  caseLink: 'https://case-center.example/CC-58800',
  subject: 'Login fails sporadically — APAC region',
  requester: 'Wei Zhang',
  fitId: 'fit-apac' | null,             // must match OWNERS.fit[].id
  hqId: 'hq-identity' | null,           // must match OWNERS.hq[].id
  currentOwner: 'fit' | 'hq' | null,
  status: 'with_fit',                   // see enum above
  flags: [],                            // 'weekend' | 'escalated' | 'scheduled_ooc'
  priority: 'low' | 'medium' | 'high',
  caseType: 'access' | 'data' | 'mobile' | 'network' | 'service' | 'productivity',
  weekId: 'W23-2026',                   // ref WEEKS[].id
  carriedFrom: 'W22-2026',              // OPTIONAL — set on rolled-over cases

  // SLA clock — total time the case has been "on us"
  slaStartedAt: '2026-06-04T22:00:00Z', // when SLA last (re)started
  slaPaused: false,                     // true while returned_to_requester
  slaAccumulatedMs: 0,                  // frozen ms from previous pause segments

  // Per-owner hold clock
  holdMs: { fit: 0, hq: 0 },            // accrued ms while owned by each
  holdStartedAt: '2026-06-04T22:30:00Z',// current owner's hold start, or null

  lastOwnerContact: { at: '...', channel: 'Slack' | 'JIRA' | 'Email' } | null,

  // ONE active handover note. Set staleForCurrentShift: true to demo the
  // "needs fresh write before cutover" rule.
  handover: {
    note: 'Pinged FIT-APAC at 09:30, no reply yet.',
    author: 'op-na',                    // operator id
    from: 'Night', to: 'Day',
    at: '2026-06-05T07:50:00Z',
    staleForCurrentShift: true,         // OPTIONAL
  } | null,

  notes: 'Free-text background',
  fitCannotResolve: true,               // OPTIONAL — unlocks "Escalate to HQ"
  closedAt: '...', resolutionCode: 'fixed_by_owner', // closed cases only

  createdAt: '2026-06-04T22:00:00Z',
  createdBy: 'op-na',                   // operator id
  history: [
    { at: '...', who: 'op-na', kind: 'created' },
    { at: '...', who: 'op-na', kind: 'assigned',  detail: 'Local FIT — APAC desk' },
    { at: '...', who: 'op-da', kind: 'escalated', detail: 'FIT → HQ Identity' },
    { at: '...', who: 'op-da', kind: 'returned',  detail: 'Returned to requester (need repro)' },
    { at: '...', who: 'op-da', kind: 'status',    detail: 'HQ → Sanity Check' },
    { at: '...', who: 'op-da', kind: 'flag',      detail: 'Marked Escalated (watch)' },
    { at: '...', who: 'op-da', kind: 'closed',    detail: 'Resolution: fixed_by_owner' },
    { at: '...', who: 'op-da', kind: 'cancelled', detail: 'Duplicate' },
    { at: '...', who: 'op-da', kind: 'rolled_over', detail: 'Carried W22 → W23' },
  ],
}
```

`history.kind` values: `created | assigned | escalated | returned | status | flag | closed | cancelled | note | rolled_over`.

## Coverage to aim for

A good seed exercises every UI surface. Spread cases across:

- **Statuses** — at least one of each (`new`, `with_fit`, `with_hq`, `sanity_check`, `returned_to_requester`, plus historical `closed` and `cancelled`).
- **Flags** — at least one `weekend` and one `escalated`.
- **Idle thresholds** — one FIT case past `fitIdleHours`, one HQ case past `hqIdleHours` to drive the watchlist.
- **SLA** — one case past `approachingSlaHours` (drives the SLA watchlist banner).
- **Handover freshness** — at least one case with `staleForCurrentShift: true` so the cutover-blocked rule shows.
- **Escalation history** — one case with a full `created → assigned → escalated → status` chain (drives Status Flow demo).
- **Carry-over** — one case with `carriedFrom` set, dated into a prior `weekId` to show rollover.
- **Historical weeks** — a handful of `closed`/`cancelled` cases in W-1, W-2, W-3 to populate Weekly Archive medians.

Current production seed has ~14 active + ~9 historical cases. Match that ballpark unless asked otherwise.

## Generation recipe

1. **Pick the demo NOW.** A weekday mid-shift time is best (e.g. Friday 13:00 UTC). All other timestamps anchor off it.
2. **Build the calendar.** Set `CURRENT_WEEK` to the ISO week containing NOW. Add 3 prior weeks to `WEEKS`. Use `'W{NN}-{YYYY}'` ids.
3. **Decide the active operator and shift.** `CURRENT_OPERATOR_ID` + `CURRENT_SHIFT.endsAtUtc` (typically NOW − 1h to show "ends soon" coloring, or NOW + a few hours).
4. **Write active cases first** (current week), then historical closed/cancelled cases for prior weeks.
5. **Validate the routing invariants** above for every case before saving.
6. **Run the bundler** so `standalone.html` updates:
   ```bash
   node prototype/bundle.mjs
   ```
7. **Sanity-check in the browser**: open `prototype/index.html`, verify the operator dropdown is populated, kanban shows cases in expected columns, and the Action Queue is empty (queue is operator-curated).

## Common mistakes to avoid

- Forgetting `slaPaused: true` on `returned_to_requester` — SLA clock will run forever.
- Leaving `holdStartedAt` set on closed/cancelled cases — hold clock will keep accruing.
- `fitId`/`hqId` that don't match any `OWNERS` id — silent breakage (owner shows as `—`).
- `weekId` that doesn't match a `WEEKS[].id` — case won't appear in Weekly Archive.
- Using local time instead of UTC `Z` suffix — SLA math is off by the TZ offset.
- Forgetting to rerun `bundle.mjs` — GitHub Pages serves stale `standalone.html` but local `file://` users see the old data.
- Bumping the case schema without bumping `STORAGE_KEY` in `app.js` — returning users get stuck with stale localStorage. If you add/remove top-level fields on `CASES`, change the key (e.g. `case-tracker-state-v2` → `v3`).

## Quick reference: seed checklist

```text
[ ] window.NOW set, plausible weekday
[ ] OPERATORS: 4 (DA, NA, DB, NB)
[ ] OWNERS.fit: 3 desks, all Phoenix TZ
[ ] OWNERS.hq: 3 teams, all Taipei TZ
[ ] WEEKS: current + 3 prior, ids match what cases reference
[ ] SHIFTS: Day + Night with operatorIds
[ ] CASES covers: new, with_fit, with_hq, sanity_check, returned_to_requester, closed, cancelled
[ ] At least one weekend flag, one escalated flag
[ ] One stale handover, one carried-over case
[ ] All FIT/HQ ids reference OWNERS
[ ] All weekIds reference WEEKS
[ ] node prototype/bundle.mjs run
```
