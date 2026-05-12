# threenine — Case Tracker (Excel replacement)

This repo holds the **User Requirements Document** and a **click-through web prototype** for replacing the team's shared Excel case-tracking workbook.

- **URD**: [`docs/URD.md`](docs/URD.md) — the authoritative spec.
- **Prototype**: [`prototype/`](prototype/) — a static, no-build web app (HTML / CSS / JS) that demos the URD concepts against seeded mock data. Auto-deployed to GitHub Pages on every push to this branch.

> The prototype is for design review, not production. There's no auth, no backend, and reloading the page resets all state.

## Run the prototype

**Online (deployed):** GitHub Pages publishes the contents of `prototype/` via the workflow at `.github/workflows/pages.yml`. After enabling **Settings → Pages → Source = GitHub Actions**, the site is reachable at the Pages URL shown in the deploy job (typically `https://<user>.github.io/threenine/`).

**Locally — easiest (just open a file):** double-click `prototype/standalone.html`, or open it in any browser via `file://`. It's a self-contained build of the prototype with the CSS and JS inlined, so no HTTP server or relative file fetches are needed. This is the recommended path for sharing the prototype as a single file.

**Locally — modular sources (for editing):** open `prototype/index.html` after running a local HTTP server. The modular files (`data.js`, `app.js`, `tour.js`, `styles.css`) load via `<script src>` and `<link rel>`, which works fine over `http://`:

```bash
cd prototype && python3 -m http.server 8000
# then open http://localhost:8000
```

**Re-bundling after edits:** the modular source files are the source of truth. When you edit any of them, regenerate `standalone.html`:

```bash
node prototype/bundle.mjs
```

The Pages workflow runs this step automatically on every deploy.

## Take the interactive tour

The prototype ships with a built-in guided tour: ~10 stepped tooltips that walk through every screen. It launches automatically the first time you load the app, and you can re-launch any time via **Take the tour →** in the sidebar footer. Use **← / →** keys to step, **Esc** to skip.

## Demo anchor — what "now" means

To keep the demo stable, the prototype freezes time:

- **NOW** = `2026-05-08 13:00 UTC` (Friday afternoon UTC)
- **Current week** = `W19 · May 4 – 10, 2026`
- **Current operator** = Alex Chen (Day shift). Switch to Sam Patel (Night) or Jordan Kim (Day) anytime via the **Operator** dropdown in the sidebar.

Because NOW sits just past the configured Day-shift cutoff, end-of-shift prompts fire on the Action Queue — the demo is intentionally calibrated to exercise the handover flow.

## Feature tour

The sidebar has five top-level views. Counts next to each are live.

### 1. Action Queue (`#/queue`)

The home screen — a per-operator to-do list derived from open-case state. Each case appears once with one or more **prompt rows**:

| Prompt                         | Fires when                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------- |
| **Assign to Local FIT**        | Status = New and no FIT contact yet.                                          |
| **Chase Local FIT — no resp.** | Status = With FIT and last contact > 4h ago.                                  |
| **Escalate to HQ Product Team**| FIT explicitly cannot resolve.                                                |
| **Chase HQ — no response**     | Status = With HQ and last contact > 8h ago.                                   |
| **Verify reported fix**        | Status = Sanity Check (owner says it's fixed).                                |
| **Approaching SLA**            | Time on us > 20h and SLA clock is still running.                              |
| **Watch escalated case**       | Case has the Escalated flag and isn't already in Sanity Check.                |
| **End-of-shift handover note** | Shift ending soon and the open case has no fresh note for this shift.         |

Thresholds are shown in the header and configurable in `prototype/data.js → THRESHOLDS`.

Each chase prompt shows the owner's **time-zone chip** with their local time and office hours — green when in-hours, amber when out-of-hours. The system never gates the prompt; the operator decides.

Clicking a prompt button opens a contextual modal:
- **Assign to Local FIT** → pick an FIT desk.
- **Escalate to HQ** → pick an HQ team and add a reason. FIT clock stops, HQ clock starts.
- **Send reminder** → records contact + channel, resets the idle timer.
- **Verify & close** → close with resolution code and note.
- **Return to requester** → pauses the SLA clock.
- **Write handover note** → fresh note labelled `Day → Night` (or vice versa).

State updates everywhere instantly: counters, status pills, history.

### 2. Cases (`#/cases`)

Filterable table view scoped to the **current week**. Columns mirror the legacy Excel layout (Case Link, Subject, Process Time, Status) plus the v1 split (Local FIT, HQ Product Team, Status flags). Click any row to open the case detail.

Use the search box to filter by subject or ID.

### 3. Case Detail (`#/cases/<id>`)

Everything about one case:

- **Two clocks**: SLA clock (time on us — running or paused) and per-owner hold time (FIT vs HQ accumulators).
- **Handover panel** — latest note, with `Day → Night` style shift label. Yellow background if the note is stale for the current shift.
- **Routing** — Local FIT contact, HQ Product Team contact, current owner pointer (FIT or HQ), last-contact timestamp + channel, owner office-hours chip.
- **History** — full audit trail of state changes, assignments, escalations, handovers, comments.
- **Action buttons** in the header that match the case's current state (e.g. With FIT → "Escalate to HQ", "Send reminder").

### 4. Shift Handover (`#/handover`)

The cutover screen for the current operator. Lists every open case the shift is responsible for, sorted by handover-note status:

- **Missing** (red) — no handover note at all.
- **Stale** (amber) — last note was for a different shift or marked stale.
- **Current** (green) — fresh note authored during this shift by an operator on this shift.

The **Complete handover** button stays disabled until every open case has a current note — enforcing the "no handover without a note" rule from the URD.

### 5. Shifts (`#/shifts`)

Side-by-side coverage map. Each shift card shows hours, roster (with "you" highlighted), and handover stats (handed-to, notes by shift, missing for shift). Click a shift for the detail page.

**Per-shift detail** (`#/shifts/Day`, `#/shifts/Night`) has:
- Tabs to switch between Day and Night.
- Summary bar (handed to / handed from / authored by / missing for this shift).
- **Roster** with a **"View as <name>"** button that re-renders the whole app from that operator's perspective. The fastest way to see how Sam (Night) experiences the same data.
- Three case sections: handed to this shift, missing-a-note for this shift, recent handover activity authored by this shift.

### 6. Weekly Archive (`#/archive`)

Browse past weekly workbooks (W16 through current W19). Each archive card shows total cases, open / closed / cancelled counts, **carried-in** count (cases that rolled over from the previous week), bounces (cases returned to requester at least once), and median time-on-us for closed cases.

**Per-week detail** (`#/archive/W18-2026`, etc.) shows the case table for that week with the same Excel-column layout, plus a `↩ Wxx` chip on cases that carried in. Past weeks are read-only-feeling but you can still drill into individual case detail.

The current week is badged **Current** and offers a one-click jump back to the live Cases view.

### 7. Operator switcher (sidebar)

The **Operator** row in the sidebar is a dropdown — switch between Alex (Day), Jordan (Day), Sam (Night) instantly. Every other view re-derives from that operator's perspective: the Action Queue gets re-prioritized, the Shift Handover screen targets the new shift, the "you" tag in the shift roster moves.

## How the prototype maps to the URD

| URD section              | Prototype surface                                                              |
| ------------------------ | ------------------------------------------------------------------------------ |
| §4.1 Case Record         | Case Detail panel, Cases table columns                                         |
| §4.2 Lifecycle           | Status pills + state-driven action buttons; legacy Status mapped per §4.2 table|
| §4.2.1 Process Time      | Two-clock panel; SLA clock = computed from state transitions                   |
| §4.2.2 Flags             | Weekend / Escalated / Scheduled OOC chips on case rows                         |
| §4.3 Routing & Handoff   | Assign / Escalate / Return-to-requester modals; FIT-then-HQ flow               |
| §4.4 Action Queue        | Action Queue view (`#/queue`) with the eight prompt types                      |
| §4.5 Shifts & Handover   | Shift Handover screen + Shifts pages + handover-note shift labels              |
| §4.8 Reporting & Insights| Archive index per-week stats; FIT vs HQ hold split on case detail              |
| §4.10 Weekly Workbook    | Weekly Archive views; `carriedFrom` chip on rolled-over cases                  |
| §4.11 Import / Export    | Out of scope for prototype; column map documented in URD                       |

## What's mocked and what's not

- **Mocked**: all data (operators, owner directory, cases, history). Persistence — state is in-memory only and resets on reload. Notifications, email, Slack. Authentication. The "Complete handover" button just shows an alert. Process Time is computed locally; v2 will source it from the case-center API.
- **Real**: the lifecycle rules, action-queue derivation thresholds, FIT-then-HQ flow, two-clock arithmetic, and shift-handover gating logic. These are the design decisions worth reviewing.

## Persistence and resetting

Your changes (assignments, status moves, handover notes, operator switches) are saved to the browser's `localStorage` and survive reload. To start fresh, click **Reset to seed** in the sidebar footer — it clears the saved state and restores the original seed data. Storage is scoped per file path / origin, so opening `standalone.html` from a different folder gets its own state.

## Repo layout

```
.
├── docs/
│   └── URD.md                   # User Requirements Document (v3)
├── prototype/
│   ├── index.html               # SPA shell (modular dev entry point)
│   ├── styles.css               # all styles
│   ├── app.js                   # router + render + handlers
│   ├── data.js                  # seed: operators, owners, weeks, shifts, cases
│   ├── tour.js                  # interactive guided tour
│   ├── bundle.mjs               # build script: produces standalone.html
│   ├── standalone.html          # self-contained single-file build (file://-safe)
│   └── .nojekyll                # disables Jekyll on Pages
└── .github/workflows/pages.yml  # deploys prototype/ to GitHub Pages
```
