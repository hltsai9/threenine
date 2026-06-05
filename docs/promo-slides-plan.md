# Promotional Slide Deck for the Case Tracker Website

## Context

The Case Tracker prototype (the two-status kanban board) is live at
`https://hltsai9.github.io/threenine/`. The user wants a PowerPoint deck to **promote the
website** as an **internal adoption pitch** — for the ops team / managers who would switch
off the shared Excel case-tracking workbook. Confirmed decisions: **editable `.pptx`**,
**internal adoption tone**, real app screenshots, **committed to
`claude/dual-status-case-kanban-WApps` and sent as a file**. (Build was deferred pending a
few content details; this plan stays current so it's ready to execute.)

**Updated since first draft** — the deck must now also cover features added after the plan
was written:
- **Live data from the on-prem Case Center** — a local server (`local/serve.py` →
  `casecenter.py` → `/api/cases`) feeds the board real cases on every refresh, with the
  agent's local layer (queue/handover/reminders) merged back. Credentials stay on the
  laptop. This makes the "two statuses" concrete: **Case Center status (real, external)** ×
  **agent status (local)**.
- **Ownership timeline + separated FIT/HQ time** on the case detail (see *when* a case sat
  with FIT vs HQ vs requester).
- **In-app Shift editor** on the Shifts page (add/edit operators, foolproof operator
  delete, generates the `shifts.js` snippet); roster split into `prototype/shifts.js`.
- **Live sidebar clock** (current date/time).

This pushes the deck to **~13–14 slides**.

## Approach

Create a self-contained `slides/` directory holding the generator scripts, captured
screenshots, and the built `.pptx`. Tooling installed globally (not committed):
- `pptxgenjs` → `npm install -g pptxgenjs`, required by absolute path like Playwright
  (`/opt/node22/lib/node_modules/playwright/index.js`).
- Playwright/Chromium already at `/opt/node22/lib/node_modules/playwright` — launch with
  `chromium.launch({ args: ['--no-sandbox'] })`.
- LibreOffice (`/usr/bin/soffice`) for the pptx→pdf verification render.

### Brand (from `prototype/styles.css` `:root`)
Accent `#2563eb`, good `#059669`, danger `#dc2626`, warn `#d97706`, text `#111827`,
muted `#6b7280`, border `#e5e7eb`, panel `#ffffff`, sidebar/charcoal `#1f2937`; system
sans-serif. Accent blue + charcoal as the deck's primary palette. Holder colors for any
timeline graphic: FIT amber `#fcd34d`, HQ red `#fca5a5`, requester cyan `#67e8f9`, first
line indigo `#c7d2fe` (match `.tl-*` in styles.css).

### Files to create (all new, on the branch)

1. **`slides/capture-screenshots.cjs`** — Playwright script: load
   `prototype/standalone.html`, suppress the tour via
   `addInitScript(() => localStorage.setItem('case-tracker-tour-seen-v1','1'))`, 1500×950
   viewport, navigate each hash route and write PNGs to `slides/assets/`:
   - `board.png` (`#/cases`, full board, incl. sidebar clock)
   - `column.png` (`[data-col-id="new"]` element crop — MY QUEUE / BACKLOG bands)
   - `timeline.png` (`#/cases/C-1044`, crop the **Clocks** + **Ownership timeline** region —
     the FIT/HQ split is the hero visual)
   - `handover.png` (a board card's ⚠ Note button / reading-panel "Write handover note")
   - `shifts.png` (`#/shifts`, coverage cards)
   - `shift-editor.png` (`#/shifts`, the `.roster-editor` panel; optionally open the
     foolproof delete modal `.re-refbox` for a second crop)
   - `archive.png` (`#/archive`), `flow.png` (`#/flow`)
   Mirrors the Playwright snippet already proven this session (element `.screenshot()` for
   crops). Note: live Case Center data is local-only, so screenshots use seed data; the
   live-data slide uses a diagram, not a screenshot.

2. **`slides/build-deck.cjs`** — `pptxgenjs` generator, 16:9 (`LAYOUT_WIDE`), consistent
   title bar + footer ("Case Tracker" + page number + live URL). Builds the slides below,
   embeds screenshots via `slide.addImage`, draws the live-data architecture diagram with
   shapes. Writes `slides/Case-Tracker-Overview.pptx`.

3. **`slides/assets/*.png`** — generated screenshots (committed; versioned & rebuildable).

4. **`slides/README.md`** — "how to regenerate" (install the two global deps; run capture
   then build).

### Slide structure (~14, internal adoption pitch)

1. **Title** — "Case Tracker — retire the Excel workbook" + tagline + live URL.
2. **The problem** — Excel pain: free-form cells/data integrity, no action queue (relies on
   memory), no reporting on where cases are stuck, unenforced verbal handover. (URD §1.)
3. **The solution** — one board, two statuses; full **board.png**.
4. **Two statuses, one board** — columns = **Case Center status**; top/bottom rows = **agent
   status** (MY QUEUE vs BACKLOG); **column.png**.
5. **Live from Case Center** *(new)* — real cases pulled from the on-prem Case Center on
   every refresh; runs locally, credentials stay on the laptop; the agent's queue/handover/
   reminders are preserved across refreshes. Simple `browser → local server → Case Center`
   diagram. (From `local/README.md`.)
6. **One-click actions** — Assign / Chase / Escalate / Verify surfaced on cards by state +
   idle thresholds; the agent never hunts.
7. **Two clocks + ownership timeline** *(updated)* — SLA (time on us) and **separated Local
   FIT vs HQ** time, plus the color-coded timeline of *who held the case when*;
   **timeline.png**.
8. **Handover, on the board** — fresh `Day → Night` note from the card; banner + ⚠ Note;
   no separate screen, no lost context; **handover.png**.
9. **Shift coverage** — Day/Night roster, handover stats, "View as" perspective;
   **shifts.png**.
10. **Manage your own roster** *(new)* — in-app Shift editor: add/edit operators, **foolproof
    operator delete** (reassign records or block, never orphan), generates the `shifts.js`
    snippet; **shift-editor.png**.
11. **Reporting Excel can't** — weekly archive stats (opened/closed/carried-in, bounces,
    median time-on-us); **archive.png**.
12. **Clear lifecycle** — status flow diagram, valid transitions; **flow.png**.
13. **Why switch** — concise Excel-vs-Case-Tracker contrast: structured data, action queue,
    SLA + FIT/HQ visibility, enforced auditable handover, live Case Center data, dashboards,
    zero-install web app.
14. **Call to action** — try it at `https://hltsai9.github.io/threenine/` (built-in tour,
    changes persist locally); for live data run `python3 local/serve.py`.

### Reuse, not reinvent
- Screenshot capture mirrors the working Playwright pattern (global module path,
  `--no-sandbox`, tour-suppress init script, element `.screenshot()` for crops).
- Copy from the (updated) `README.md` feature sections, `docs/URD.md` §1–2 (problem/goals),
  and `local/README.md` (live-data flow). No invented product claims.
- `prototype/standalone.html` is the screenshot target (no dev server needed).

## Verification

1. `node slides/capture-screenshots.cjs` → ~8 PNGs in `slides/assets/`; spot-check
   `board.png` shows "Board · W23" + the four columns + MY QUEUE/BACKLOG bands + sidebar
   clock, and `timeline.png` shows the FIT/HQ clocks and the ownership timeline bar.
2. `node slides/build-deck.cjs` → writes `Case-Tracker-Overview.pptx`. Confirm it's a valid
   OOXML package: `unzip -l slides/Case-Tracker-Overview.pptx` lists
   `ppt/slides/slide1.xml … slide14.xml`.
3. Visual check: `soffice --headless --convert-to pdf --outdir /tmp slides/Case-Tracker-Overview.pptx`,
   then Read the PDF pages to confirm layout, images render, and text isn't clipped.
4. Commit `slides/` (scripts + assets + pptx + README) to
   `claude/dual-status-case-kanban-WApps`, push, and `SendUserFile` the `.pptx`.
