# User Requirements Document — Case Tracking Tool (Excel Replacement)

**Date:** 2026-05-08
**Status:** Draft v3
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
- **Local FIT (owner, first line)** — represented as records (name, region, time zone, posted office hours, contact channel). First port of call for a new case. Does **not** log in.
- **HQ Product Team (owner, second line)** — represented as records (name, product area, time zone, posted office hours, contact channel). Receives cases that Local FIT cannot resolve. Does **not** log in.
- **Requester** — represented as a field on the case; does not log in. Assigning a case back to the requester pauses the SLA clock.

## 4. Functional Requirements

### 4.1 Case Record
Each case must capture at minimum (Excel column → field mapping in parentheses):
- Case ID (system-generated, stable across weekly workbooks)
- Case-center link / reference *(Excel: **Case Link**)* — URL or ID of the upstream record. Free-text in v1; API-linked in v2.
- Subject / summary *(Excel: **Subject**)*
- Requester
- Local FIT contact *(Excel: **Local FIT**)* — owner record, optional
- HQ Product Team contact *(Excel: **HQ Product Team**)* — owner record, optional
- Current owner pointer — `Local FIT` or `HQ Product Team` (or unassigned). Determines which owner the chase prompts target.
- Status *(Excel: **Status**)* — see §4.2
- Process Time *(Excel: **Process Time**)* — see §4.2.1
- Weekend Case flag — boolean, separate from status (see §4.2.2)
- Priority
- Case type / category (referential)
- Week (workbook the case is currently filed under — see §4.10)
- SLA-clock state: running / paused, accumulated time
- Owner-hold-clock state: running per owner, with per-owner accumulated time
- Last contact with current owner (timestamp + channel)
- Handover note *(Excel: **Handover**)* — latest only, with author, source-shift, target-shift (e.g. day → night)
- Notes *(Excel: **Note**)* — free-text rolling notes; comments thread (§4.6) is the v1 replacement, but a single Notes field is preserved for migration parity
- Created at / created by, last updated at / by

### 4.2 Lifecycle (state machine)
The legacy Excel `Status` column conflates three concepts: **state**, **action prompt**, and **flag**. v1 splits them.

**v1 states (the Status field):**
**New → With Local FIT → With HQ Product Team → Sanity Check → Resolved → Closed**, plus **Returned to Requester**, **Cancelled**, and **Reopened** from Closed.

- **With Local FIT** — case sits with first-line; covers the legacy "2nd line did not handle" situation when the operator is chasing FIT.
- **With HQ Product Team** — case has been escalated past FIT; covers legacy `Product Team Handling`.
- **Sanity Check** — owner reports a fix; operator verifies before closing. Maps to legacy `Sanity Check`.
- **Returned to Requester** — pauses the SLA clock; covers legacy `Need to contact user, please assist` when used as a state rather than a prompt.

Rules:
- The **SLA clock** runs in *New*, *With Local FIT*, *With HQ Product Team*, and *Sanity Check*. It pauses in *Returned to Requester*. It stops in *Resolved* and *Closed*.
- The **owner-hold clock** runs whenever an owner is assigned and the case is not in *Returned to Requester*; per-owner accumulation so we can report Local FIT hold time vs. HQ Product Team hold time separately.
- Closing a case requires a resolution note and a resolution code.
- Transitions are explicit and audit-logged. Any operator may transition any case.

**Legacy Status → v1 mapping (used by the importer in §4.11):**

| Legacy Status                           | v1 Status              | Action-queue item (§4.4)               | Flag (§4.2.2) |
|-----------------------------------------|------------------------|----------------------------------------|---------------|
| `Weekend Case`                          | (preserve current)     | —                                      | Weekend Case  |
| `Escalated, please keep an eye on this` | (preserve current)     | "Watch escalated case"                 | Escalated     |
| `2nd line did not handle`               | With Local FIT         | "Chase Local FIT — no response"        | —             |
| `Escalate to Local FIT`                 | New                    | "Assign to Local FIT"                  | —             |
| `Need to contact user, please assist`   | (preserve current)     | "Contact requester / return to requester" | —          |
| `Product Team Handling`                 | With HQ Product Team   | —                                      | —             |
| `Case Closed`                           | Closed                 | —                                      | —             |
| `Sanity Check`                          | Sanity Check           | "Verify owner's reported fix"          | —             |
| `Scheduled OOC`                         | (preserve current)     | —                                      | Scheduled OOC *(definition TBD — see §8)* |

#### 4.2.1 Process Time
- **v1**: system-computed from state-transition timestamps. Surfaced as the SLA-clock accumulator (i.e. "time on us"). The legacy manually-typed value is migrated as a one-time seed and then replaced by the computed value going forward.
- **v2**: sourced from the case-center API; the local computation becomes a fallback / cross-check.

#### 4.2.2 Flags (orthogonal to status)
- **Weekend Case** — set automatically when a case is created during the configured weekend window; visible as a tag, used for reporting only.
- **Escalated (watch)** — set by an operator when a case needs heightened attention regardless of which owner has it. Replaces legacy `Escalated, please keep an eye on this`.
- **Scheduled OOC** — preserved during migration; semantics confirmed with operators before v1 GA (see §8).

### 4.3 Routing & Handoff
- **Manual assignment is primary**: the operator picks the owner from the owner directory.
- **Default flow**: New → assign to **Local FIT** → if FIT cannot resolve, the operator escalates to **HQ Product Team**. Both the FIT contact and the HQ contact are retained on the case once populated; the *current owner pointer* says which one is active.
- Switching the current owner pointer stops the previous owner's hold clock and starts the next one. Per-owner accumulators are preserved.
- Assigning back to the requester is a first-class action that pauses the SLA clock and clears the current-owner pointer (FIT/HQ records remain on the case for context).
- Every assignment / reassignment is recorded with timestamp, actor, from→to, and reason (optional).

### 4.4 Action Queue (per-operator to-do list)
The home screen for each operator is a prioritized list of prompts derived from the cases they are coordinating. The queue must surface, at minimum:
- **Assign to Local FIT** — new case has no FIT owner yet (replaces legacy `Escalate to Local FIT` status).
- **Chase Local FIT — no response** — case has sat with FIT past the idle threshold (replaces legacy `2nd line did not handle`).
- **Escalate to HQ Product Team** — FIT has reported they cannot resolve, or FIT has exceeded the escalation threshold without progress.
- **Chase HQ Product Team — no response** — case has sat with HQ past the idle threshold.
- **Verify reported fix (Sanity Check)** — owner says it's fixed; operator must confirm before closing.
- **Contact requester / return to requester** — replaces legacy `Need to contact user, please assist`. Pauses the SLA clock when actioned.
- **Watch escalated case** — surfaced for cases flagged Escalated regardless of owner.
- **Approaching SLA** — case has been on us long enough that the operator should return it to the requester or escalate.
- **End-of-shift handover** — for every open case the operator owns, prompt to write/refresh a handover note before shift cutover.
- **Owner office hours** — each chase prompt must display the current owner's local time and posted office hours so the operator can decide whether to act now or defer. The system does **not** gate prompts on time-of-day; the operator decides.
- Operators can snooze, dismiss with reason, or act on each prompt; dismissals are audit-logged.

### 4.5 Shifts & Handover
- Shifts and shift membership are configured by admins. Day ↔ Night is the canonical pair; other configurations are allowed.
- Shift cutover is **manual**: the outgoing operator clicks "complete handover" once every open case in their bucket has a current handover note; the incoming operator clicks "take over."
- The Handover field on the case is **latest-only** (one current note labelled with source-shift → target-shift, e.g. `Day → Night`). Prior handover notes are preserved in the audit log, not in the field.
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
- **Status dashboards** — counts by status, current owner pointer (FIT vs. HQ), team, age bucket; overdue view; "stuck with owner" view.
- **Two-clock reporting** — for any slice: total elapsed, **time on us** (SLA-clock running), **time with owner** (owner-hold-clock running, split by FIT vs. HQ), **time with requester** (SLA-clock paused).
- **FIT vs. HQ split** — what fraction of cases are resolved by Local FIT without HQ escalation; median time-with-FIT before escalation.
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
- **Import**: CSV/Excel import for initial migration, with column mapping, validation preview, and per-row error reporting before commit.
- **Default column map** for the existing weekly workbooks:

  | Excel column      | v1 field                                                              |
  |-------------------|------------------------------------------------------------------------|
  | Case Link         | Case-center reference (URL/ID)                                         |
  | Subject           | Subject / summary                                                      |
  | Process Time      | Seed value for SLA-clock accumulator (then system-computed; §4.2.1)    |
  | Status            | Split into v1 Status + Action-queue prompt + Flag per §4.2 mapping    |
  | Handover          | Handover note (latest-only, with shift labels)                         |
  | Local FIT         | Local FIT contact (owner record)                                       |
  | HQ Product Team   | HQ Product Team contact (owner record)                                 |
  | Note              | Notes field + auto-imported as initial comment thread entry            |

- **Export**: any list/view exportable to CSV/Excel; audit log exportable per case; weekly snapshot exportable as a workbook for archive parity (with the original 8 columns reconstructable for hand-back to legacy consumers).

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
1. **Thresholds**: numeric values for FIT-idle, HQ-idle, "approaching SLA," and escalation criteria — workshop with operators.
2. **Resolution codes / case types** — workshop with operators.
3. **Shift definitions** — exact times of Day vs. Night (and any others), team membership, weekend coverage.
4. **Week start** — day and local time of the weekly rollover.
5. **`Scheduled OOC` definition** — the legacy status is preserved during migration but its meaning is unclear; confirm with operators whether it is a flag, a future-dated state, or obsolete.
6. **`Weekend Case` semantics** — confirm whether it changes SLA treatment or is reporting-only.
7. **Owner directory seed** — source of truth for the Local FIT and HQ Product Team rosters (incl. time zones and posted office hours) — pull from HRIS, IT directory, or maintained manually in §4 admin tools?
8. **History depth** — how many past weekly workbooks to import for v1.
9. **v2 case-center API** — contract, polling vs. push, authoritative source for Process Time, conflict resolution when both systems edit a case.
10. **SSO provider** (Google / Microsoft / Okta) — confirm with IT.
11. **Targets** for §7 success metrics.
