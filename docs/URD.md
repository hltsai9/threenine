# User Requirements Document — Case Tracking Tool (Excel Replacement)

**Date:** 2026-05-07
**Status:** Draft v2
**Owner:** Product

## 1. Background & Problem
A department of 10–50 front-line operators currently uses a shared Excel workbook to coordinate cases between **external requesters** and **external owners** (the people who actually resolve the work). The front-line team does not resolve cases themselves — they route, chase, escalate, and hand cases back to requesters. A new weekly workbook is created each week.

Today's pain points:
- **Data integrity** — free-form cells lead to inconsistent values, broken formulas, and missing fields.
- **No action queue** — operators rely on memory and ad-hoc filters to know what they need to do next (chase an owner, escalate, return to requester, write handover).
- **Reporting** — the team cannot easily answer "where are cases stuck?", "which owners are slow?", "how much time is on us vs. on the requester?"
- **Shift handover** — handover today is verbal or via a side document; nothing is enforced or auditable.

## 2. Goals & Non-Goals
**Goals (v1)**
- Replace the weekly Excel workbook as the system of record for cases.
- Enforce structured, validated data entry.
- Surface a per-operator action queue that tells them what to do next.
- Track two distinct clocks: **SLA clock** (time on us) and **owner-hold clock** (time the owner has the case).
- Support a manual end-of-shift handover with a written summary per open case.
- Provide dashboards Excel cannot.
- Enable a smooth migration from the existing Excel workbooks.

**Non-goals (v1)**
- External requester or external owner self-service (front-line operators only log in).
- Direct integration with the upstream **case center** system — front-line operators continue to read case state from the case center manually. v2 will pull this via API.
- Fine-grained / role-based permissions beyond operator vs. admin.
- SLA breach auto-alerting to external parties.
- Native mobile app.

## 3. Users & Roles (v1)
- **Front-line operator** — any department member. Coordinates cases: assigns to owners, chases, escalates, returns to requesters, writes handover notes. The only logged-in user type.
- **Admin** — manages reference data (owners, teams, case types, escalation thresholds, shift definitions, dropdown values) and the operator user list.
- **Owner** — represented as a record (name, team, time zone, posted office hours, contact channel) but does **not** log in. Cases are assigned *to* owner records so the operator knows whom to chase.
- **Requester** — represented as a field on the case; does not log in. Assigning a case back to the requester pauses the SLA clock.

## 4. Functional Requirements

### 4.1 Case Record
Each case must capture at minimum:
- Case ID (system-generated, stable across weekly workbooks)
- Source case-center reference (free-text in v1; API-linked in v2)
- Title / summary
- Requester (the party the case originated from and will be returned to)
- Current owner (an owner record, may be unassigned)
- Status (see lifecycle)
- Priority
- Case type / category (referential)
- Team or queue (referential)
- Week (workbook the case is currently filed under — see §4.10)
- SLA-clock state: running / paused, accumulated time
- Owner-hold-clock state: running when assigned to an owner, accumulated time
- Last contact with owner (timestamp + channel)
- Handover note (latest, with author and shift)
- Created at / created by, last updated at / by

### 4.2 Lifecycle (state machine)
States: **New → Assigned to Owner → Awaiting Owner → Returned to Requester → Resolved → Closed**, plus **Escalated** and **Cancelled**, plus **Reopened** from Closed.

- The **SLA clock** runs in *New*, *Assigned to Owner*, *Awaiting Owner*, and *Escalated*. It pauses in *Returned to Requester*. It stops in *Resolved* and *Closed*.
- The **owner-hold clock** runs whenever an owner is assigned and the case is not in *Returned to Requester*.
- Closing a case requires a resolution note and a resolution code.
- Transitions are explicit and audit-logged. Any operator may transition any case.

### 4.3 Routing & Handoff
- **Manual assignment is primary**: the operator picks the owner from the owner directory.
- Reassigning to a new owner stops the previous owner's hold clock and starts a new one.
- Assigning back to the requester is a first-class action that pauses the SLA clock and clears the current owner.
- Every assignment / reassignment is recorded with timestamp, actor, from→to, and reason (optional).
- Optional team queues from which an operator may pull a case to themselves for coordination.

### 4.4 Action Queue (per-operator to-do list)
The home screen for each operator is a prioritized list of prompts derived from the cases they are coordinating. The queue must surface, at minimum:
- **Owner idle** — owner has held the case past a configurable threshold without response → "send a reminder."
- **Approaching SLA** — case has been on us long enough that the operator should consider returning it to the requester or escalating.
- **Escalation criteria met** — priority/age/repeat-non-response combination triggers an "escalate now" prompt.
- **End-of-shift handover** — for every open case the operator owns, prompt to write/refresh a handover note before shift cutover.
- **Owner office hours** — each prompt that involves contacting an owner must display the owner's local time and posted office hours so the operator can decide whether to act now or defer. The system does **not** gate prompts on time-of-day; the operator decides.
- Operators can snooze, dismiss with reason, or act on each prompt; dismissals are audit-logged.

### 4.5 Shifts & Handover
- Shifts and shift membership are configured by admins.
- Shift cutover is **manual**: the outgoing operator clicks "complete handover" once every open case in their bucket has a current handover note; the incoming operator clicks "take over."
- A case cannot be marked handed-over without a handover note authored during the current shift.
- The system records who handed over which cases to whom and when.
- An operator can see all open cases pending their incoming handover.

### 4.6 Comments & History
- Threaded comments per case, timestamped, with author.
- @-mentions of other operators trigger notifications (see §4.9).
- Comments are immutable once posted (short edit/delete window for the author, TBD).
- Handover notes are a separate, structured field — not buried in the comment thread.

### 4.7 Data Integrity
- **Required + typed fields**: dropdowns, date pickers, numeric fields — no free text where a list will do.
- **Referential integrity**: owner must be an active owner record; team/queue/case type must exist in reference data; closing a case requires a valid resolution code.
- **Audit log**: every field change records who/what/when/old→new; viewable per case; exportable.

### 4.8 Reporting & Insights
- **Status dashboards** — counts by status, owner, team, queue, age bucket; overdue view; "stuck with owner" view.
- **Two-clock reporting** — for any slice: total elapsed, **time on us** (SLA-clock running), **time with owner** (owner-hold-clock running), **time with requester** (SLA-clock paused).
- **Owner performance** — median/percentile owner-hold time per owner and per team; non-response rate.
- **Bounce metrics** — number of times a case was returned to the requester before close.
- **Trend charts** — opened vs. closed over time, throughput, median time-to-resolution.
- **Filtered / saved views** — per-operator saved filters; shareable view links.
- **Weekly rollups** — per-week summary aligned to the weekly workbook concept (§4.10).

### 4.9 Notifications
- Primary surfacing is the in-app action queue (§4.4).
- Secondary channels: **Email** and **Slack**, configurable per operator.
- Triggers: assigned to me, @-mentioned, escalation prompt, end-of-shift reminder, returned-to-me from another operator.

### 4.10 Weekly Workbook
- The Excel workflow is organized one workbook per week; the tool preserves this concept as a reporting and grouping construct. The week start day/time is configured by an admin.
- **Rollover is manual**: at week-end, an operator (or admin) reviews each open case and chooses for each one: carry into next week, close, or cancel. Carried cases retain their case ID and full history; only the "week" filing changes.
- Reports can be filtered or rolled up by week.

### 4.11 Import / Export
- **Import**: CSV/Excel import for initial migration, with column mapping, validation preview, and per-row error reporting before commit. Must accommodate the existing weekly workbook layout.
- **Export**: any list/view exportable to CSV/Excel; audit log exportable per case; weekly snapshot exportable as a workbook for archive parity.

### 4.12 Authentication
- Logged-in access required for operators and admins. SSO is desirable but not a hard v1 requirement.

## 5. Non-Functional Requirements
- **Volume**: 50–500 new cases per week; cases live days-to-weeks. List/dashboard queries should remain responsive at ~10× this volume (cases table 100k+).
- **Concurrency**: multiple operators may edit the same case; last-write-wins per field with audit log; comment posting is conflict-free.
- **Availability**: business-hours availability target across all shifts the team runs; routine backups; recoverable to prior day.
- **Browser support**: latest Chrome/Edge/Firefox/Safari; usable on a mobile browser (no native app).

## 6. Migration
- One-time bulk import of the most recent weekly Excel workbooks (history depth TBD).
- Parallel-run period during which the Excel workbook is read-only; all new cases go in the tool starting from the next week boundary.
- Excel workbooks archived once the adoption metric in §7 is met.

## 7. Success Metrics
Tracked at 30/60/90 days post-launch:
- **Data quality** — ≥ X% of cases have all required fields populated at close (target TBD).
- **Action-queue adoption** — ≥ X% of owner-chase / escalation / return actions originate from the action queue rather than ad-hoc lists (target TBD).
- **Handover discipline** — ≥ X% of open cases have a current-shift handover note at cutover time (target TBD).
- **Operator satisfaction** — CSAT / NPS survey; target score TBD.
- *(Secondary, monitored: median time-on-us, median owner-hold, return-to-requester count per case.)*

## 8. Open Questions
1. **Thresholds**: numeric values for "owner idle," "approaching SLA," and escalation criteria — workshop with operators.
2. **Resolution codes / case types** — workshop with operators.
3. **Shift definitions** — exact times, team membership, weekend coverage.
4. **Week start** — day and local time of the weekly rollover.
5. **History depth** — how many past weekly workbooks to import for v1.
6. **v2 case-center API** — contract, polling vs. push, conflict resolution when both systems edit a case.
7. **SSO provider** (Google / Microsoft / Okta) — confirm with IT.
8. **Targets** for §7 success metrics.
