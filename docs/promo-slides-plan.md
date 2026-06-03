# Promotional Slide Deck for the Case Tracker Website

## Context

The Case Tracker prototype (the two-status kanban board) is now live at
`https://hltsai9.github.io/threenine/`. The user wants a PowerPoint deck to **promote
the website** as an **internal adoption pitch** — aimed at the ops team / managers who
would switch off the shared Excel case-tracking workbook. Decisions confirmed with the
user: **editable `.pptx`**, **internal adoption tone**, **standard ~12 slides** with real
app screenshots, **committed to `claude/dual-status-case-kanban-WApps` and sent as a file**.

The deck is generated programmatically (so it's reproducible and on-brand) using
`pptxgenjs`, with screenshots captured from the running app via the Playwright/Chromium
setup already proven to work this session. All copy and colors are reused from the repo.

## Approach

Create a self-contained `slides/` directory in the repo holding two generator scripts, the
captured screenshots, and the built `.pptx`. Tooling is installed globally (not committed):
- `pptxgenjs` → `npm install -g pptxgenjs`, required by absolute path like we did for
  Playwright (`/opt/node22/lib/node_modules/playwright/index.js`).
- Playwright/Chromium already at `/opt/node22/lib/node_modules/playwright` — launch with
  `chromium.launch({ args: ['--no-sandbox'] })`.
- LibreOffice (`/usr/bin/soffice`) for a pptx→pdf verification render.

### Brand (reused from `prototype/styles.css` `:root`)
Accent `#2563eb`, good `#059669`, danger `#dc2626`, warn `#d97706`, text `#111827`,
muted `#6b7280`, border `#e5e7eb`, panel `#ffffff`, sidebar/charcoal `#1f2937`; system
sans-serif. Use accent blue + charcoal as the deck's primary palette.

### Files to create (all new, on the branch)

1. **`slides/capture-screenshots.cjs`** — Playwright script that loads
   `prototype/standalone.html` (self-contained, no server), suppresses the tour via
   `addInitScript(() => localStorage.setItem('case-tracker-tour-seen-v1','1'))`, sets a
   1500×950 viewport, navigates each hash route and writes PNGs to `slides/assets/`:
   - `board.png` (`#/cases`, full board), `column.png` (`[data-col-id="new"]` element crop —
     the MY QUEUE / BACKLOG bands), `detail.png` (`#/cases/C-1044`, two clocks + handover +
     routing + history), `shifts.png` (`#/shifts`), `archive.png` (`#/archive`),
     `flow.png` (`#/flow`). Reuses the exact pattern from the verification step earlier.

2. **`slides/build-deck.cjs`** — `pptxgenjs` generator. 16:9 layout (`LAYOUT_WIDE`).
   Helper for a consistent title bar + footer (logo text "Case Tracker" + page number +
   the live URL). ~12 slides (structure below). Embeds the screenshots with
   `slide.addImage`. Writes `slides/Case-Tracker-Overview.pptx`.

3. **`slides/assets/*.png`** — generated screenshots (committed so the deck is rebuildable
   and the images are versioned).

4. **`slides/README.md`** — one-paragraph "how to regenerate" (install the two global deps,
   run capture then build).

### Slide structure (~12, internal adoption pitch)

1. **Title** — "Case Tracker — retire the Excel workbook" + one-line tagline + live URL.
2. **The problem** — Excel pain (free-form cells/data integrity, no action queue/relies on
   memory, no reporting on where cases are stuck, unenforced verbal handover). From URD §1.
3. **The solution** — one board, two statuses; full **board.png**.
4. **Two statuses, one board** — columns = Case Center status; top/bottom rows = agent
   status (MY QUEUE vs BACKLOG); **column.png**.
5. **One-click actions** — Assign / Chase / Escalate / Verify surfaced on cards by state +
   idle thresholds; the agent never hunts.
6. **Two clocks** — SLA clock (time on us) vs owner-hold clock (FIT vs HQ); **detail.png**.
7. **Handover, on the board** — fresh `Day → Night` note written from the card; banner +
   ⚠ Note; no separate screen, no lost context.
8. **Shift coverage** — Day/Night roster, handover stats, "View as" perspective;
   **shifts.png**.
9. **Reporting Excel can't** — weekly archive stats (opened/closed/carried-in, bounces,
   median time-on-us); **archive.png**.
10. **Clear lifecycle** — status flow diagram, valid transitions; **flow.png**.
11. **Why switch** — concise Excel-vs-Case-Tracker contrast (structured data, action queue,
    SLA visibility, enforced auditable handover, dashboards, zero-install web app).
12. **Call to action** — try it now at `https://hltsai9.github.io/threenine/`, built-in
    guided tour, changes persist locally / reset to seed.

### Reuse, not reinvent
- Screenshot capture mirrors the working Playwright snippet used to verify the board
  earlier (same global module path, `--no-sandbox`, tour-suppress init script, element
  `.screenshot()` for the column crop).
- Copy is lifted from `README.md` (feature one-liners) and `docs/URD.md` §1–2
  (problem/goals) — already extracted; no new product claims invented.
- `prototype/standalone.html` is the screenshot target (no dev server needed).

## Verification

1. `node slides/capture-screenshots.cjs` → confirm 6 PNGs land in `slides/assets/` and
   spot-check `board.png` shows "Board · W23", the four columns, and MY QUEUE/BACKLOG bands.
2. `node slides/build-deck.cjs` → writes `Case-Tracker-Overview.pptx`. Sanity-check it's a
   valid OOXML package: `unzip -l slides/Case-Tracker-Overview.pptx` shows
   `ppt/slides/slide1.xml … slide12.xml` (≈12 slides).
3. Visual check: `soffice --headless --convert-to pdf --outdir /tmp slides/Case-Tracker-Overview.pptx`,
   then Read the PDF pages to confirm layout, that images render, and text isn't clipped.
4. Commit `slides/` (scripts + assets + pptx + README) to
   `claude/dual-status-case-kanban-WApps`, push, and `SendUserFile` the `.pptx`.
