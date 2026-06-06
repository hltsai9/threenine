# threenine — Case Tracker (Excel replacement)

This repo holds the **User Requirements Document** and a **click-through web prototype** for replacing the team's shared Excel case-tracking workbook.

- **URD**: [`docs/URD.md`](docs/URD.md) — the authoritative spec.
- **Prototype**: [`prototype/`](prototype/) — a static, no-build web app (HTML / CSS / JS) that demos the URD concepts against seeded mock data. Auto-deployed to GitHub Pages on every push to this branch.

> The prototype is for design review, not production. There's no auth, no backend, and reloading the page resets all state.

- **Back end** (new): [`backend/`](backend/README.md) — a decoupled pipeline that loads cases into a database so the front end needs **no API key / cookie**. An ingestion script (the only holder of Case Center credentials) writes cases to a DB; a FastAPI service + the static SPA read from it. **SQLite for demos, PostgreSQL/MySQL for production on Kubernetes** (`deploy/`), selected by `DATABASE_URL`. This supersedes the per-user `local/serve.py` live-proxy (which is still fine for a single-user local run).

## Run the prototype

**Online (deployed):** GitHub Pages publishes the contents of `prototype/` via the workflow at `.github/workflows/pages.yml`. After enabling **Settings → Pages → Source = GitHub Actions**, the site is reachable at the Pages URL shown in the deploy job (typically `https://<user>.github.io/threenine/`).

**Locally — easiest (just open a file):** double-click `prototype/standalone.html`, or open it in any browser via `file://`. It's a self-contained build of the prototype with the CSS and JS inlined, so no HTTP server or relative file fetches are needed. This is the recommended path for sharing the prototype as a single file.

**Locally — modular sources (for editing):** open `prototype/index.html` after running a local HTTP server. The modular files (`data.js`, `shifts.js`, `owners.js`, `app.js`, `tour.js`, `styles.css`) load via `<script src>` and `<link rel>`, which works fine over `http://`:

```bash
cd prototype && python3 -m http.server 8000
# then open http://localhost:8000
```

**Re-bundling after edits:** the modular source files are the source of truth. When you edit any of them, regenerate `standalone.html`:

```bash
node prototype/bundle.mjs
```

The Pages workflow runs this step automatically on every deploy.

## ⚠️ Local setup checklist — after you pull

A few files need attention **every time you pull this repo to your local machine** (they're either
gitignored, stubs, or get clobbered by the local virus scanner). Don't skip these or live mode
won't work:

| File | What to do |
| ---- | ---------- |
| `local/casecenter.py` → `fetch_raw()` | Paste your real Case Center request logic here — the committed version is a **stub**. It should return the list of raw records (`x_json["data"]`). Do **not** hardcode credentials here. |
| `local/secrets.local.json` | **Gitignored — won't exist after a clone.** Create it and fill in your `apiKey` + `cookie`: `cp local/secrets.local.json.example local/secrets.local.json` (or set `CASE_CENTER_API_KEY` / `CASE_CENTER_COOKIE` env vars instead). |
| `prototype/index.html` | The local **virus scan may delete parts** of this file. Re-check it after pulling and restore if needed: `git restore prototype/index.html`. |
| `prototype/standalone.html` | Same virus-scan issue. Easiest fix is to **regenerate** it from the modular sources: `node prototype/bundle.mjs` (or `git restore prototype/standalone.html`). |

Quick restore for the two HTML files in one go:

```bash
git restore prototype/index.html
node prototype/bundle.mjs   # rebuilds standalone.html from source
```

Then run the live backend (see `local/README.md`):

```bash
python3 local/serve.py   # then open the localhost URL it prints
```

## Take the interactive tour

The prototype ships with a built-in guided tour: ~10 stepped tooltips that walk through every screen. It launches automatically the first time you load the app, and you can re-launch any time via **Take the tour →** in the sidebar footer. Use **← / →** keys to step, **Esc** to skip.

## Demo anchor — what "now" means

To keep the demo stable, the prototype freezes time:

- **NOW** = `2026-05-08 13:00 UTC` (Friday afternoon UTC)
- **Current week** = `W19 · May 4 – 10, 2026`
- **Current operator** = Alex Chen (Day shift). Switch to Sam Patel (Night) or Jordan Kim (Day) anytime via the **Operator** dropdown in the sidebar.

Because NOW sits just past the configured Day-shift cutoff, the board's handover banner and per-card ⚠ Note buttons light up — the demo is intentionally calibrated to exercise the handover flow.

## Feature tour

The sidebar has four top-level views. Counts next to each are live.

### 1. Board (`#/cases`)

The home screen and the single workspace where the first-line agent does everything. Each case now carries **two statuses**:

- **Case Center status** — the real, external case status (sourced from the Case Center system; a future API will supply it). This drives the four kanban **columns**: New → With Local FIT → With HQ Product Team → Sanity Check / With Requester.
- **Agent status** — how the first-line agent is handling the case. This drives the **top/bottom split** inside each column. The **top band ("My queue")** holds the cases the agent has pulled in to work right now; the **bottom band ("Backlog")** holds the rest. Clicking **+ Queue** on a card lifts it into the top band of its column (★); clicking **✓ Queued** drops it back.

Each card surfaces a **one-click action** when one applies, so the old standalone Action Queue is unnecessary:

| Action on card                 | Fires when                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------- |
| **Assign to Local FIT**        | Status = New and no FIT contact yet.                                          |
| **Chase Local FIT — no resp.** | Status = With FIT and last contact > 4h ago.                                  |
| **Escalate to HQ Product Team**| FIT explicitly cannot resolve.                                                |
| **Chase HQ — no response**     | Status = With HQ and last contact > 8h ago.                                   |
| **Verify reported fix**        | Status = Sanity Check (owner says it's fixed).                                |

Thresholds are configurable in `prototype/data.js → THRESHOLDS`. Click any card to open the **reading panel** below, where you can change status, send reminders, set a bell, and **write the handover note** — without leaving the board. The contextual modals are unchanged:
- **Assign to Local FIT** → pick an FIT desk.
- **Escalate to HQ** → pick an HQ team and add a reason. FIT clock stops, HQ clock starts.
- **Send reminder** → records contact + channel, resets the idle timer.
- **Verify & close** → close with resolution code and note.
- **Return to requester** → pauses the SLA clock.
- **Write handover note** → fresh note labelled `Day → Night` (or vice versa).

**Handover, folded into the board.** There is no separate handover screen. When the shift is ending, a banner above the board reports how many open cases still need a fresh note for this shift, and every card needing one shows a **⚠ Note** button — write each straight from the board. Below the board, watchlists flag cases approaching SLA or carrying the Escalated flag. State updates everywhere instantly: counters, status pills, history.

### 2. Case Detail (`#/cases/<id>`)

Everything about one case:

- **Two clocks**: SLA clock (time on us — running or paused) and per-owner hold time (FIT vs HQ accumulators).
- **Handover panel** — latest note, with `Day → Night` style shift label. Yellow background if the note is stale for the current shift.
- **Routing** — Local FIT contact, HQ Product Team contact, current owner pointer (FIT or HQ), last-contact timestamp + channel, owner office-hours chip.
- **History** — full audit trail of state changes, assignments, escalations, handovers, comments.
- **Action buttons** in the header that match the case's current state (e.g. With FIT → "Escalate to HQ", "Send reminder", "Write handover note").

### 3. Shifts (`#/shifts`)

Side-by-side coverage map. Each shift card shows hours, roster (with "you" highlighted), and handover stats (handed-to, notes by shift, missing for shift). Click a shift for the detail page.

**Per-shift detail** (`#/shifts/Day`, `#/shifts/Night`) has:
- Tabs to switch between Day and Night.
- Summary bar (handed to / handed from / authored by / missing for this shift).
- **Roster** with a **"View as <name>"** button that re-renders the whole app from that operator's perspective. The fastest way to see how Sam (Night) experiences the same data.
- Three case sections: handed to this shift, missing-a-note for this shift, recent handover activity authored by this shift.

### 4. Weekly Archive (`#/archive`)

Browse past weekly workbooks (W16 through current W19). Each archive card shows total cases, open / closed / cancelled counts, **carried-in** count (cases that rolled over from the previous week), bounces (cases returned to requester at least once), and median time-on-us for closed cases.

**Per-week detail** (`#/archive/W18-2026`, etc.) shows the case table for that week with the same Excel-column layout, plus a `↩ Wxx` chip on cases that carried in. Past weeks are read-only-feeling but you can still drill into individual case detail.

The current week is badged **Current** and offers a one-click jump back to the live board.

### 5. Operator switcher (sidebar)

The **Operator** row in the sidebar is a dropdown — switch between Mia (Day), Kai (Day), Ren (Night), Yui (Night) instantly. Everything re-derives from that operator's perspective: the board's queue and one-click actions re-prioritize, the handover banner and ⚠ Note buttons target the new shift, and the "you" tag in the shift roster moves.

## How the prototype maps to the URD

| URD section              | Prototype surface                                                              |
| ------------------------ | ------------------------------------------------------------------------------ |
| §4.1 Case Record         | Case Detail panel, board cards + reading panel                                 |
| §4.2 Lifecycle           | Case Center status drives the kanban columns; state-driven action buttons      |
| §4.2.1 Process Time      | Two-clock panel; SLA clock = computed from state transitions                   |
| §4.2.2 Flags             | Weekend / Escalated / Scheduled OOC chips on cards                             |
| §4.3 Routing & Handoff   | Assign / Escalate / Return-to-requester modals; FIT-then-HQ flow               |
| §4.4 Action Queue        | Per-column **top band** ("My queue") + one-click actions on cards              |
| §4.5 Shifts & Handover   | Handover banner + ⚠ Note buttons on the board + Shifts pages                   |
| §4.8 Reporting & Insights| Archive index per-week stats; FIT vs HQ hold split on case detail              |
| §4.10 Weekly Workbook    | Weekly Archive views; `carriedFrom` chip on rolled-over cases                  |
| §4.11 Import / Export    | Out of scope for prototype; column map documented in URD                       |

## What's mocked and what's not

- **Mocked**: all data (operators, owner directory, cases, history). Persistence — state is in-memory only and resets on reload. Notifications, email, Slack. Authentication. The Case Center status is seeded locally; v2 will source the real status (and Process Time) from the case-center API while the agent status stays local.
- **Real**: the lifecycle rules, the two-status model (Case Center status vs agent status), the one-click action thresholds, FIT-then-HQ flow, two-clock arithmetic, and handover awareness. These are the design decisions worth reviewing.

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
│   ├── data.js                  # seed: weeks, cases, thresholds, clock
│   ├── shifts.js                # roster: operators, shifts, default operator (edit here)
│   ├── owners.js                # FIT desks & HQ teams (edit here / via the Owners page)
│   ├── tour.js                  # interactive guided tour
│   ├── bundle.mjs               # build script: produces standalone.html
│   ├── standalone.html          # self-contained single-file build (file://-safe)
│   └── .nojekyll                # disables Jekyll on Pages
└── .github/workflows/pages.yml  # deploys prototype/ to GitHub Pages
```
