# CommuGround Case Tracker — Operator Guide

How to use the case board day-to-day: pick cases, track where they are, hand them over between
shifts, and export status tables for the team chat. This guide is for **operators**; if you're
setting up or deploying the tool, see [`SETUP.md`](SETUP.md) instead.

> 💡 The app has a built-in walkthrough — click **"Take the tour →"** at the bottom of the sidebar.
> It also starts automatically on your first visit.

---

## 1. Signing in

1. Open the board URL. If the team API is protected, you'll see **Sign in** — enter the shared
   **access token** (ask your admin; it's not your personal password).
2. Next, **"Who are you?"** — pick your name from the operator list. Everything you do (picks,
   handover notes, Track Status changes) is recorded under this name, so choose correctly.
3. Your operator choice is remembered **per browser/device**. To switch person later, use the
   **On shift** dropdown at the bottom of the sidebar.
4. **Sign out** (sidebar footer) clears the token for this tab.

The case data and the operator roster come from the team database — everyone sees the same board.

## 2. The screen at a glance

**Sidebar (left):**

| Item | What it is |
| --- | --- |
| **Picked** | Your working view: the Hand-off Route Board + the cases you're actively following |
| **Overview** | Every case, grouped by week — this is your triage inbox |
| **Shifts** | Day/Night rosters, the weekly rota, and shift handover status |
| **Owners** | The Core Team desks and HQ Product Teams cases route to |
| **Status Flow** | Reference: how Case Center statuses map onto the board (read once, then as needed) |
| **Clock model** | Reference: what each timer/clock on a case means |
| Clock | Live time with a **timezone toggle** (e.g. MST / GMT+8) — all displayed times follow it |
| **On shift** | The active operator (you), with your shift and when it ends |

**Two statuses per case — the key concept:**

- **Case Center status** (the colored pill, e.g. *In-Progress*, *Close*) — where the case really is
  in Case Center. The board only mirrors it; you never edit it here.
- **Track Status** (set by you) — your *intent* for the case: where it should go next. This drives
  the Route Board arrows and deadlines. It never gets sent back to Case Center.

## 3. Daily workflow

### Step 1 — Triage in Overview

Open **Overview**, scan the current week's table, and hit **+ Pick** on any case you'll follow up.
Picked cases move into your **Picked** workspace. Use the **"Picked only"** filter to see what's
already being handled.

- A case whose Case Center status is **Close/Drop cannot be picked** — it's finished.
- If a case is too old to be on the board, use **+ Import case by ID** (top of the Picked page):
  type its Case Center ID and it's fetched, added, and auto-picked under your name.

### Step 2 — Work your Picked workspace

The **Picked** page has three zones:

- **Hand-off Route Board (top)** — one row per picked case showing where it sits across
  **User → 1st Line → Core Team → HQ** (see §4).
- **Picked cases list (bottom-left)** — your cases, newest activity first. Click a row to read it.
  The **◂ Hide** button collapses the list to give the reading panel full width.
- **Reading panel (bottom-right)** — full detail of the selected case: clocks, routing, the latest
  handover note, and the complete history. Act from here without leaving the page.

### Step 3 — Set a Track Status

In the reading panel (or case detail), pick a **Track Status** that matches your intent:

| Track Status | What it does |
| --- | --- |
| **Weekend Case** | Schedules a hand-off to **HQ** (Sun 17:30 MST) — animated arrow + deadline chip |
| **HQ did not handle** | Re-schedules a hand-off to **HQ** (next Day shift 17:30 MST) |
| **Escalate to Core Team** | Schedules a hand-off to **Core Team** (next Day shift 09:00 MST) |
| **Escalated to HQ — keep an eye** | Watch mode: eye + dashed ring once the case reaches HQ |
| **Need to contact user** | Watch mode at the **User** station |
| **Case Closed** | Marks your follow-up done; the case drops out of the active workspace |
| **Sanity Check** | Groups the case into the collapsible **Sanity Check** section of the Route Board |

The suggested ones for your current shift are marked, but every value is always available. For the
three scheduled statuses you can override the hand-off time when you set them.

### Step 4 — Assign a Core Team member

When a case is heading to the Core Team, click its **deadline chip on the Route Board** (or use the
case's own controls) to assign it to a **specific Core Team desk and member** — the member is
required. The chip then shows the member's name, and exports show it in the *Core Team* column.

### Step 5 — Hand over at shift end

Every open picked case should carry a **fresh handover note** for the next shift:

- A banner on the Picked page warns when notes are missing near shift end.
- Write the note from the case's reading panel — either a general **end-of-shift note** or
  **addressed to a specific teammate** (the Route Board then shows an arrow → their name).
- Every note's full text is kept in the case **History** (and in exports), so nothing is lost when
  a newer note replaces the current one.

## 4. Reading the Hand-off Route Board

- **Solid dot** — the case is parked at that station (User / 1st Line / Core Team / HQ) right now.
- **Travelling dot on an arrow** — a scheduled hand-off is in motion toward the target station,
  with a **deadline chip** at the arrow's end (it turns **red when overdue**).
- **Dashed ring + eye** — a watch-mode case (*Escalated to HQ*, *Need to contact user*).
- **Person icon** — who picked the case; **arrow icon** — who it was handed to.
- **Mine only** (toggle in the green title bar) — show just your cases.
- **Sanity Check · N cases** — a collapsible group at the bottom; click the header to expand or
  collapse it (the panels below move up to reclaim the space).

## 5. Exporting for the team chat

At the bottom of the Route Board's green frame:

- **Copy as table** — puts a real table on the clipboard: paste into **MS Teams** (or Outlook,
  Excel…) and it renders as a table, not plain text.
- **Export to CSV** — downloads the same data as a `.csv` file.

Columns: **Case Link · Subject · IT Process Time · Track Status · Handover Route (operator A →
operator B) · Core Team (assigned member) · HQ Product Team · Note**. The *Note* column aggregates
the case's whole history, one line per entry, each prefixed `MM/DD OperatorName:`.

The **Overview** page has its own **Copy as table** for a week's case list.

## 6. Keeping case data fresh

- Cases sync from Case Center automatically on a schedule (ask your admin how often).
- The **⟳ button on any case** re-fetches that one case from Case Center immediately — use it when
  you know something just changed (status, assignee, process timeline).
- **+ Import case by ID** brings in a case the schedule hasn't loaded (e.g. an old one).
- If ⟳ shows *"Server-side ingest failed"*, the API host is missing Case Center credentials —
  that's an admin fix (see [`SETUP.md`](SETUP.md)); scheduled syncs may still work.

Your operator work (picks, Track Status, notes, reminders) is **never overwritten** by a data
refresh — only the Case-Center-owned fields (status, subject, assignee, timeline…) update.

## 7. Clocks and times

- **SLA · time on us** — how long the case has been actively on IT (1st Line + Core/Service +
  Unknown stages). This is the number in the *IT Process Time* export column.
- **Total time** — the case's whole lifetime, including time waiting on the user.
- **On us** — the share of total time that was on IT.
- All times display in the timezone selected under the sidebar clock; actions are recorded at the
  real current time (the same one the sidebar clock shows).
- Full definitions: the **Clock model** page in the sidebar.

## 8. Shifts & Owners pages

- **Shifts** — both shifts side-by-side with rosters and handover counts; open a shift for its
  detail and rota. Edits are saved to the team database with the **Save** button, so everyone gets
  the updated roster (it also feeds the sign-in operator list).
- **Owners** — the Core Team desks (with members) and HQ Product Teams that cases can be assigned
  to, plus the Case-Center department lists that decide which station a case's assignee belongs to.
  Also saved to the shared database.

## 9. Overview extras

- **Week cards** show totals, carry-overs, bounces (returned to requester), and median time-on-us.
- **Recycle bin** (in Overview) — deleted cases sit here before being purged; restore or delete
  forever.

## 10. Troubleshooting

| Symptom | Likely cause / what to do |
| --- | --- |
| "That token was rejected" at sign-in | Wrong/rotated access token — ask your admin for the current one |
| Sign-in screen appears mid-session | The token was rotated; sign in again — your work is saved |
| Board is empty + "Could not reach the case API" | The backend is down/unreachable — refresh later or tell your admin |
| A case shows **Close** but an odd column color | Fixed automatically on load; refresh the page if you see it |
| **+ Pick** missing on a case | The case is Closed/Dropped — finished cases can't be picked |
| ⟳ says "Server-side ingest failed (HTTP 502)" | API host lacks Case Center credentials — admin fix ([`SETUP.md`](SETUP.md)) |
| "Case … not found in Case Center" on import | Check the ID; the case may be outside your access |

---

*More detail: the in-app **Status Flow** and **Clock model** pages, the repo
[`README.md`](../README.md) (feature tour), and [`SETUP.md`](SETUP.md) (deployment & credentials).*
