# threenine — CommuGround (Case Tracker)

**CommuGround** is a case-tracking tool for first-line IT operators — it replaces the team's
shared Excel workbook and makes the hand-off between the **requester (User)**, **1st Line**, the
**Core Team**, and **HQ** visible at a glance. This repo holds the requirements, a zero-build web
app, and an optional Python backend that turns the prototype into a real multi-operator service.

- **URD**: [`docs/URD.md`](docs/URD.md) — the authoritative spec.
- **Prototype**: [`prototype/`](prototype/) — a static, no-build SPA (vanilla HTML / CSS / JS)
  that runs the whole UI against seeded mock data. Auto-deployed to GitHub Pages on every push.
- **Backend** (optional): [`backend/`](backend/README.md) — a decoupled **ingest → DB → API**
  pipeline so the front end needs **no API key/cookie**. An ingestion script (the only holder of
  Case Center credentials) writes cases to a database; a FastAPI service + the static SPA read
  from it behind a shared-token login. **SQLite for demos, MySQL/PostgreSQL for production**,
  selected by `DATABASE_URL`. (A simpler single-user live proxy, [`local/serve.py`](local/README.md),
  also exists.)

> The static prototype is for design review and demos: no auth, no server, state lives in the
> browser. The **backend** adds the auth, shared database, and live Case Center ingestion that a
> deployment needs — see **[Going to production](#going-to-production)**.

## Run it

Quickest look: open `prototype/standalone.html` via `file://` (self-contained, no server).
For editing the modular sources, the deployed Pages site, the local-setup checklist after a pull,
Case Center credentials, and the full environment-variable table, see
**[`docs/SETUP.md`](docs/SETUP.md)** — the single source of truth for running and configuring the
app. To self-host the full stack (API + DB + login) on your own box, follow
**[`docs/SELF-HOST-UBUNTU.md`](docs/SELF-HOST-UBUNTU.md)**.

## Demo anchor — what "now" means

To keep the demo stable, the prototype freezes time (`prototype/data.js`):

- **NOW** = `2026-06-12 13:00 UTC` (Friday afternoon UTC)
- **Current week** = `W24 · June 7 – 13, 2026`
- **Current operator** = **Mia** (Day shift). Switch to **Kai** (Day), **Ren** (Night), or
  **Yui** (Night) anytime via the **Operator** dropdown in the sidebar. Everything re-derives
  from the chosen operator's shift.

Because NOW sits late in the Day shift, the handover banner and per-card ⚠ Note prompts light up —
the demo is calibrated to exercise the shift-handover flow.

## The core idea — two statuses per case

Every case carries two independent statuses, and keeping them apart is the whole point:

- **Case Center status** (`c.status`) — the real, external status owned by the Case Center system
  (`new`, `with_core`, `with_hq`, `returned_to_requester`, `closed`, …). The operator never edits
  it; ingestion refreshes it. It, plus the assignee's **department**, decides where a case **is**.
- **Operator layer** — what the first-line operator does *about* the case this shift: which cases
  they **pick** into their workspace, the **Track Status** (their *intent* — where the case
  *should* go next), the **handover note** they leave a teammate, and any **reminder**. This layer
  is theirs; Case Center never sees it.

The **Hand-off Route Board** is where these two meet visually (below).

## Feature tour

The sidebar has the operator switcher and the views below. Counts next to each are live.

### Picked workspace + Hand-off Route Board (`#/cases`)

The home screen and the single workspace where the operator works. Two parts:

- **Hand-off Route Board** — one strip showing where every picked case sits across four stations:
  **User → 1st Line → Core Team → HQ**. A case's **dot** marks its *current* Case Center location
  (derived from the assignee's department + latest process-timeline `processType`, via the
  configurable `CC_CORE_DEPARTMENTS` / `CC_HQ_DEPARTMENTS` lists in `owners.js`). The operator's
  **Track Status** is the *desired* location — so when current ≠ desired, the row draws an
  **intent arrow / animation** pulling toward the target (e.g. a case still on the User while you
  need HQ to pick it up shows a watch ring + arrow). A 1st-Line case shows a dashed arrow each way
  ("decide where it goes"). The legend pairs each colour with a shape so it reads under pressure.
- **Picked list + reading panel** — the cases you've pulled in to work this shift, with a detail
  panel beside them. From the panel you set the **Track Status**, write a **handover note**
  addressed to a teammate, set a **reminder**, and jump out to Case Center — without leaving the
  page. The panel also shows the case's clocks (SLA "time on us", plus Core vs HQ hold totals) and
  its Case Center process timeline.

**Track Status values** (operator intent, set from the panel): Weekend Case, HQ did not handle,
Escalate to Core Team, Escalated to HQ — keep an eye, Need to contact user, Case Closed, Sanity
Check. The first three schedule a hand-off at a fixed time; the "keep an eye" ones draw a watch
ring until you've authored the handover.

**Handover, folded in.** There is no separate handover screen. When the shift is ending, a banner
reports how many picked cases still need a fresh note for this shift, and each one offers a
**⚠ Note** button.

### Overview (`#/archive`)

The triage inbox: every case by week (past weekly workbooks through the current week). Scan a
week's table and hit **+ Pick** to lift a case into your Picked workspace. Cards show totals,
carry-overs (rolled over from the previous week), bounces (returned to requester), and median
time-on-us. Past weeks read-only-feeling; you can still drill into any case.

### Shifts (`#/shifts`)

Side-by-side Day vs Night coverage. Each shift card shows hours, roster (with "you" highlighted),
and handover stats. Click into a shift for its detail, where **"View as &lt;operator&gt;"** lets
you see exactly what the other shift sees without switching operator.

### Owners (`#/owners`)

The Core Team desks and HQ Product Teams a case can route to, plus the Route Board department
lists. Edit them here for the session; paste the snippet into `owners.js` to keep them.

### Help pages — Status Flow (`#/flow`) and Clock model (`#/clocks`)

Reference views that explain how Case Center statuses map to the board and how the SLA / Core /
HQ clocks are reconstructed from case history (so the numbers always reconcile).

### Operator switcher (sidebar)

Switch between **Mia** (Day), **Kai** (Day), **Ren** (Night), **Yui** (Night) instantly.
Everything re-derives from that operator's perspective: the Picked workspace, suggested Track
Statuses, the handover banner, and the "you" tag in the shift roster.

## The guided tour

CommuGround ships a built-in tour (stepped tooltips walking each view). It is **config-gated**:
`window.TOUR_AUTOSTART` in `prototype/config.js` controls auto-start, **default `false`** (internal
operators don't need onboarding on every fresh browser). Set it to `true` to auto-start once per
browser for a demo. Either way, anyone can launch it from **Take the tour →** in the sidebar
footer. Use **← / →** to step, **Esc** to skip.

## Going to production

The static prototype has no auth and no shared state. The backend supplies both:

- **Credentials stay on the ingest side.** Only `backend/ingest.py` (via `local/casecenter.py`)
  holds the Case Center API key + cookie; it writes cases into the database. The read API and the
  SPA need no credentials.
- **Shared-token login.** Set `API_AUTH_TOKEN` and the API gates `/api/cases` + `/api/save` behind
  a bearer token; the SPA shows a login screen and stores the token in `sessionStorage`. The SPA
  auto-detects the backend by probing `/healthz` — leave `API_MODE=''` and it switches to server
  mode by itself.
- **One DB switch.** `DATABASE_URL` selects SQLite (demo) / MySQL / PostgreSQL with no code change
  (`backend/db.py`). Each case is stored as a board-shaped JSON `payload`.
- **Live ingestion.** A systemd timer (or cron) runs `backend.ingest` on a schedule, upserting
  **only** Case-Center-owned fields so operator work is preserved.

Full step-by-step: **[`docs/SELF-HOST-UBUNTU.md`](docs/SELF-HOST-UBUNTU.md)** (MySQL) and
**[`backend/README.md`](backend/README.md)** (architecture). Kubernetes manifests live in
[`deploy/`](deploy/).

## How the prototype maps to the URD

| URD section               | Prototype surface                                                          |
| ------------------------- | -------------------------------------------------------------------------- |
| §4.1 Case Record          | Reading panel in the Picked workspace; case clocks + history               |
| §4.2 Lifecycle            | Case Center status drives station placement; Track Status drives intent    |
| §4.2.1 Process Time       | SLA / Core / HQ clocks + the Case Center process timeline panel             |
| §4.2.2 Flags              | Weekend / Escalated / scheduled-handoff chips on Route Board rows           |
| §4.3 Routing & Hand-off   | Hand-off Route Board (User → 1st Line → Core Team → HQ) + Track Status      |
| §4.4 Action Queue         | The Picked workspace (pick cases to work this shift)                        |
| §4.5 Shifts & Handover    | Handover banner + ⚠ Note prompts + the Shifts pages                        |
| §4.8 Reporting & Insights | Overview per-week stats; Core vs HQ hold split on the case panel            |
| §4.10 Weekly Workbook     | Overview week views; `carriedFrom` chip on rolled-over cases               |
| §4.11 Import / Export      | Live Case Center ingestion (backend) + `+ Import case by ID`               |

## What's mocked and what's not

- **Mocked (static prototype):** all seed data (operators, owner directory, cases, history). With
  no backend, state lives in the browser and resets on **Reset to seed**. The Case Center status
  is seeded locally.
- **Real (with the backend):** shared multi-operator persistence in a database, shared-token auth,
  and live Case Center ingestion — the seed becomes a fallback.
- **Real design decisions worth reviewing either way:** the two-status model (Case Center status
  vs operator intent), the current-vs-desired Route Board, the station/department mapping,
  the Track-Status hand-off scheduling, the clock arithmetic, and the shift-handover awareness.

## Persistence and resetting

In the static prototype, your changes (picks, Track Status, handover notes, operator switches)
are saved to the browser's `localStorage` and survive reload; **Reset to seed** in the sidebar
footer clears them. With the backend, edits round-trip to the database instead and are shared
across operators and devices.

## Repo layout

```
.
├── docs/
│   ├── URD.md                   # User Requirements Document (authoritative spec)
│   ├── SETUP.md                 # how to run / credentials / every env var (single source)
│   ├── SELF-HOST-UBUNTU.md      # full-stack self-host runbook (MySQL)
│   ├── RELEASE_NOTES.md         # newest-first change log (required per change)
│   └── improvement-plan.md      # the one TODO / backlog home
├── prototype/                   # the zero-build SPA
│   ├── index.html               # SPA shell (modular dev entry point)
│   ├── styles.css               # all styles
│   ├── app.js                   # router + render + handlers
│   ├── config.js                # API_BASE / API_MODE / TOUR_AUTOSTART (front-end config)
│   ├── data.js                  # seed: weeks, cases, thresholds, frozen clock
│   ├── shifts.js                # operators + shifts + default operator
│   ├── owners.js                # Core Team desks, HQ teams, CC department lists
│   ├── tour.js                  # interactive guided tour
│   ├── bundle.mjs               # build script → standalone.html
│   ├── standalone.html          # self-contained single-file build (file://-safe)
│   ├── favicon.svg
│   ├── .nojekyll                # disables Jekyll on Pages
│   └── tests/                   # zero-dependency test harness (node run.cjs)
├── local/                       # single-user live proxy (serve.py + casecenter.py + persist.py)
├── backend/                     # ingest → DB → API pipeline (FastAPI + SQLAlchemy)
├── deploy/                      # Dockerfiles + Kubernetes manifests
├── slides/                      # promo deck (pptxgenjs) + screenshot capture
└── .github/workflows/pages.yml  # deploys prototype/ to GitHub Pages
```
