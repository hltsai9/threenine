# User Requirements Document — Case Tracking Tool (Excel Replacement)

**Date:** 2026-05-07
**Status:** Draft v1
**Owner:** Product

## 1. Background & Problem
A department of 10–50 people currently uses a shared Excel file to track cases that are handed off between owners until resolved and returned to the requester. Two pain points block the team today:
- **Data integrity** — free-form cells lead to inconsistent values, broken formulas, and missing fields.
- **Reporting** — the team cannot easily answer questions like "where are cases stuck?" or "how long does each owner hold a case?"

## 2. Goals & Non-Goals
**Goals (v1)**
- Replace the shared Excel file as the system of record for cases.
- Enforce structured, validated data entry.
- Provide dashboards and time-tracking that Excel cannot.
- Enable a smooth migration from existing Excel data.

**Non-goals (v1)**
- External requester self-service portal (internal handlers only).
- Fine-grained / role-based permissions (v1 = any logged-in user can edit).
- SLA breach alerting (deferred; only time-spent measurement in v1).
- Native mobile app.

## 3. Users & Roles (v1)
- **Handler** — any department member. Can create, view, edit, comment on, and reassign any case.
- **Admin** — manages reference data (teams, queues, case types, dropdown values) and user list.
- *(Requesters are represented as a field on the case but do not log into v1.)*

## 4. Functional Requirements

### 4.1 Case Record
Each case must capture at minimum:
- Case ID (system-generated)
- Title / summary
- Requester (the person the case originated from / will be returned to)
- Current owner
- Status (see lifecycle)
- Due date
- Case type / category (referential)
- Team or queue (referential)
- Created at / created by, last updated at / by

### 4.2 Lifecycle (state machine)
States: **Open → In Progress → Pending → Resolved → Closed**, plus **Reopened**, **Escalated**, **Cancelled**.
Transitions are explicit; any handler may transition a case. Closure requires a resolution note.

### 4.3 Routing & Handoff
Three routing modes must coexist:
1. **Manual reassignment** — current owner picks the next owner.
2. **Predefined workflow stages** — case type defines an ordered set of stages; advancing a stage may auto-assign to a default owner/queue.
3. **Team / skill queues** — cases can be placed in a queue from which team members claim them.

Every reassignment is recorded with timestamp, from-owner, to-owner, and reason (optional).

### 4.4 Comments
- Threaded comments per case, timestamped, with author.
- @-mentions trigger notifications (see 4.7).
- Comments are immutable once posted (edit/delete by author within a short window TBD).

### 4.5 Data Integrity
- **Required + typed fields**: dropdowns, date pickers, numeric fields — no free text where a list will do.
- **Referential integrity**: owner must be an active user; team/queue/case type must exist in reference data; closing a case requires a valid resolution code.
- **Audit log**: every field change records who/what/when/old→new; viewable per case; exportable.

### 4.6 Reporting & Insights
- **Status dashboards** — counts by status, owner, team, queue, age bucket; overdue view.
- **Trend charts** — opened vs. closed over time, throughput, median time-to-resolution, time-spent distributions.
- **Filtered / saved views** — per-user saved filters (e.g. "my open cases", "Team X this week"); shareable view links.
- **Time tracking** — per-case total cycle time, time spent per owner, time spent per team. Surfaced both in dashboards and on the case detail.

### 4.7 Notifications
- Channels: **Email** and **Slack**.
- Triggers (configurable per user): assigned to me, @-mentioned, status change on cases I own/follow, due-date approaching/overdue, case closed.

### 4.8 Import / Export
- **Import**: CSV/Excel import for initial migration, with column mapping, validation preview, and per-row error reporting before commit.
- **Export**: any list/view exportable to CSV/Excel; audit log exportable per case.

### 4.9 Authentication
- Logged-in access required. SSO is desirable but not a hard v1 requirement.

## 5. Non-Functional Requirements
- **Volume**: 50–500 new cases per week; cases live days-to-weeks. List/dashboard queries should remain responsive at ~10× this volume (cases table 100k+).
- **Concurrency**: multiple handlers may edit the same case; last-write-wins per field with audit log; comment posting is conflict-free.
- **Availability**: business-hours availability target; routine backups; recoverable to prior day.
- **Browser support**: latest Chrome/Edge/Firefox/Safari; usable on a mobile browser (no native app).

## 6. Migration
- One-time bulk import of the existing Excel file.
- Parallel-run period during which the Excel file is read-only; all new cases go in the tool.
- Excel file archived once adoption metric is met (see §7).

## 7. Success Metrics
Tracked at 30/60/90 days post-launch:
- **Data quality** — ≥ X% of cases have all required fields populated at close (target TBD).
- **User satisfaction** — CSAT / NPS survey of handlers; target score TBD.
- *(Secondary, monitored but not a launch gate: adoption %, median time-to-resolution.)*

## 8. Open Questions
1. Specific resolution codes / case types — need a workshop with handlers.
2. SSO provider (Google / Microsoft / Okta) — confirm with IT.
3. Permission model for v2 (team scoping, field-level locks) — defer scoping until v1 telemetry is in.
4. Target thresholds for the success metrics in §7.
