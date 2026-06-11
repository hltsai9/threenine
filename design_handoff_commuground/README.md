# Handoff: CommuGround — Support × SRE Case-Ticket Board

## Overview
CommuGround is a communication tool for two teams — **Support agents** and **SRE** — to track the status of case tickets and hand them off cleanly between teams. The core goal is "where is this ticket?" answered at a glance, plus lightweight ways to talk: nudges, comment threads, and live presence. It is a **desktop web app**.

The ticket lifecycle is a 4-stage flow plus a closure column:
`New → Local Team (Support) → HQ Team (SRE) → Sanity Check (User) → Resolved`

## About the Design Files
The file in this bundle (`CommuGround.dc.html`) is a **design reference created in HTML** — a working, clickable prototype that demonstrates the intended look, layout, and behavior. **It is not production code to copy directly.** The `.dc.html` format wraps the markup in a small custom runtime (`<x-dc>`, `<sc-for>`, `<sc-if>`, a `Component` logic class). Ignore that scaffolding — read it for the styling, structure, copy, and interaction logic only.

The task is to **recreate this design in the target codebase's existing environment** (React, Vue, Svelte, etc.) using its established component library, state patterns, and conventions. If no front-end environment exists yet, implement it in React with plain CSS/CSS-modules or the team's preferred styling approach. All styling in the prototype is inline — translate it into the codebase's idiomatic styling layer.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, and interactions are all specified below and present in the prototype. Recreate the UI faithfully using the codebase's existing libraries and patterns. Exact hex values, sizes, and copy are given.

---

## Global Layout

A two-pane app shell, `display: flex`, full viewport height, on a tinted page background.

- **Left sidebar**: fixed `236px` wide, `position: sticky; top: 0; height: 100vh`, white background, `1px` right border `#f0eef7`, padding `18px 14px`, vertical flex column.
- **Main pane**: `flex: 1`, inner content capped at `max-width: 1260px`, centered, padding `16px 22px 44px`.

### Page backgrounds (theme-dependent — see Themes)
- Pop (default): `#f7f5fc`
- Refined: `#f3f1fa`
- Bold: `#141229` (dark)

Font family throughout: **Plus Jakarta Sans** (weights 400–800). Monospace accents (ticket codes, timestamps): **JetBrains Mono** (400–600). Both from Google Fonts.

---

## Sidebar (persistent across all views)

Top to bottom:

1. **Brand block**: a `34×34` rounded-`11px` gradient tile `linear-gradient(135deg, #a99cf0 0%, #f093bd 60%, #7fd0c6 125%)` with shadow `0 4px 12px rgba(169,156,240,.4)`; next to it the wordmark "CommuGround" (`800`, `17px`, color `#2e2a47`) and a mono sublabel "SUPPORT × SRE" (`9.5px`, `600`, `#a29ebb`, letter-spacing `.06em`).
2. Divider: `1px` line `#f0eef7`, margin `16px 4px`.
3. **Nav list** (vertical, gap `4px`). Four items: **Board**, **Shifts**, **Owners**, **Weekly Archive**.
   - Each item: flex row, gap `11px`, padding `11px 13px`, border-radius `12px`, font `13.5px`, cursor pointer. An emoji icon (`15px`, fixed `20px` width column), the label, a spacer, and an optional badge.
   - **Inactive**: weight `600`, color `#7d7a99` (`#b6b1d6` in Bold theme), transparent background. Hover background `#f7f5fc` (`rgba(255,255,255,.05)` in Bold).
   - **Active**: weight `700`, color `#6857c0`, background `#efeafc`, plus an inset left accent bar `box-shadow: inset 3px 0 0 #ab9ef1`.
   - **Board** carries a badge = count of open cases (cards not in Resolved). Active badge: bg `#ab9ef1`, text white. Inactive badge: bg `#efeafc`, text `#6857c0`. Badge: `11px`, `700`, padding `0 7px`, radius `8px`.
   - Icons used: Board 🗂️, Shifts 🗓️, Owners 👥, Weekly Archive 🗄️.
4. Spacer (`flex: 1`).
5. **Online pill**: pale `#f7f5fc` rounded-`13px` row, a pulsing `8px` green dot `#80cba7` + "5 teammates online" (`12px`, `600`, `#7d7a99`).
6. **Current-user chip**: bordered (`1px #f0eef7`) rounded-`13px` row: `32px` avatar circle `#ec84ad` with white "AL", name "Alex" (`12.5px`, `700`, `#2e2a47`), subtitle "Support · on shift" (`11px`, `#a29ebb`).

---

## Top Bar (persistent across all views)

Sticky (`top: 8px`), white, rounded-`18px`, shadow `0 1px 3px rgba(24,20,52,.06)`, padding `13px 18px`, flex row gap `16px`, margin-bottom `14px`.

- **Left**: page title (`800`, `18px`, `#2e2a47`) + subtitle (`12px`, `600`, `#a29ebb`). Title/subtitle change per view:
  - Board → "Board" / "Support × SRE case flow"
  - Shifts → "Shifts" / "Who's on, who's next"
  - Owners → "Owners" / "Case load by teammate"
  - Weekly Archive → "Weekly Archive" / "Resolved cases, by week"
- Spacer.
- **Search box** (visual only in prototype): `#f6f4fb` pill, padding `8px 13px`, width `200px`, "🔍 Search cases…" placeholder text `#a29ebb`.
- **Theme switch**: segmented control in a `#f6f4fb` pill (padding `3px`, radius `12px`) with three buttons Refined / Pop / Bold. Active button: white bg, `#2e2a47` text, weight `700`, shadow `0 1px 3px rgba(0,0,0,.1)`. Inactive: transparent, `#a29ebb`, weight `600`.
- **Online avatars**: overlapping row of 5 `30px` circles (`-9px` left margin overlap, `2px` white ring), each a teammate's initials.
- **+ New case** button: `linear-gradient(135deg, #9b8aed, #ec84ad)`, white text `700` `13.5px`, padding `10px 16px`, radius `11px`, shadow `0 5px 14px rgba(155,138,237,.34)`. Opens the compose modal.

---

## View 1: Board (default)

The kanban. Three stacked regions: stats strip, filter row, columns.

### Stats strip
Flex row, gap `12px`, wraps. Five stat cards (white, rounded-`16px`, shadow `0 1px 3px rgba(24,20,52,.05)`, padding `13px 15px`, flex row gap `12px`, min-width `156px`). Each: a `38px` rounded-`11px` icon tile (bg = accent at 15% alpha) + value (`21px`, `800`) + label (`11.5px`, `600`, `#a29ebb`).
- 📋 **Open cases** = count not Resolved. Accent `#ab9ef1`.
- ⏱ **Stuck — need a push** = count of stuck cards (see rules). Accent `#d98a5c`; value turns accent-colored when > 0. **Clickable** → sets filter to "stuck".
- 👤 **Awaiting the user** = count in Sanity Check. Accent `#ab9ef1`. **Clickable** → filter "await".
- 🔁 **Handoffs today** = running counter (starts 12, increments on every move). Accent `#5fc8be`.
- 🟢 **Teammates online** = 5. Accent `#80cba7`.

### Filter row
Flex row, gap `8px`, wraps. Pill buttons (`13px`, `700`, padding `8px 13px`, radius `11px`), each with a trailing count chip. Inactive: white bg, `#6c6890` text, shadow `0 1px 2px rgba(24,20,52,.05)`, count chip bg `#f4f2fa` text `#a29ebb`. Active: solid accent bg, white text, count chip bg `rgba(255,255,255,.28)`.
- **All cases** (accent `#6b6e94`) — count = all cards
- **🔥 Urgent** (`#cf6a7c`) — priority === urgent
- **⏱ Stuck** (`#d98a5c`) — stuck rule
- **My cases** (`#ec84ad`) — owner === current user ("you")
- **👤 Awaiting user** (`#ab9ef1`) — column === Sanity Check

### Columns
Horizontal flex, gap `15px`, `overflow-x: auto`, items align to top. Five columns, each `min-width: 286px; max-width: 300px`. A column = header + body (drop zone).

**Column identities** (id, name, subtitle, accent, deep-text, tint-bg):
| id | name | subtitle | accent | deep | tint |
|----|------|----------|--------|------|------|
| new | New | Unassigned · awaiting triage | `#9aa6cf` | `#5a608c` | `#eef0f8` |
| local | Local Team | Owned by Support | `#f093bd` | `#b65389` | `#fcebf3` |
| hq | HQ Team | Owned by SRE | `#5fc8be` | `#2f877f` | `#e2f5f2` |
| sanity | Sanity Check | Back with the user | `#ab9ef1` | `#6857c0` | `#efeafc` |
| resolved | Resolved | Closed out | `#80cba7` | `#429a72` | `#e7f5ed` |

**Column header (Pop theme):** solid accent background, rounded-`13px`, padding `11px 14px`, shadow `0 5px 16px {accent@34%}`. Name in **deep** color (`700`, `14px`), count chip bg `rgba(255,255,255,.55)` text deep, subtitle in deep@80% (`11px`, `600`).
- *Refined theme*: transparent header, a `9px` rounded accent dot before the name, name `#28244a`, count chip bg accent@20% text deep; body bg = tint.
- *Bold theme*: transparent header, glowing accent dot + accent name with `text-shadow`, body bg `rgba(255,255,255,.045)`.

**Column body:** flex column, gap `10px`, padding `10px`, radius `16px`, `min-height: 110px`. Pop body is white with `inset 0 0 0 1px #f1eff7`. On drag-over: inset `0 0 0 2px {accent}` and a tinted background. Empty column shows a dashed-border placeholder "Nothing here — drag a card in".

### Case card
White, rounded-`14px`, padding `13px 14px 12px 17px`, border `1px #f1eff7`, shadow `0 1px 2px rgba(24,20,52,.04), 0 5px 16px rgba(24,20,52,.05)`, `cursor: grab`, `draggable`. Hover: `translateY(-2px)` + stronger shadow. Dragging: opacity `0.4`.

Contents, top to bottom:
1. **Accent bar**: absolutely positioned left edge, `4px` wide, rounded right corners, color = column accent (glows in Bold).
2. **Meta row**: mono ticket code (`11px`, `600`, `#9591ad`, e.g. "CG-4821"); optional priority pill; spacer; optional stuck pill.
   - Priority pill **Urgent**: bg `#fbe0e5`, text `#cf6a7c`. **High**: bg `#fbecd0`, text `#b9842f`. `10.5px`, `700`, padding `2px 8px`, radius `7px`. (Normal priority shows no pill.)
   - Stuck pill: "⏱ {N}h idle", text `#d98a5c`, bg `#fbe9da`, `10.5px`, `700`.
3. **Title**: `13.5px`, `600`, line-height `1.36`, `#28244a`, `text-wrap: pretty`.
4. **Progress dots**: 4 dots representing the 4 lifecycle stages. Completed/earlier stages = `#80cba7`; current stage = a wider (`17px`) accent-colored pill; future = `#ddd9ea`. All `7px` tall, rounded `4px`, animated transitions.
5. **Footer row**: owner avatar (`24px` circle, teammate color, white initials) OR an "Unassigned" chip (`#a29ebb` on `#f4f2fa`); mono "updated" time (`11px`, `#aaa6c0`); spacer; "💬 {n}" comment count (if any); "👀 {n}" viewer count (`#8b78d8`, `700`, if any).
6. **Action row** (separated by `1px #f3f1fa` top border): **👋 Nudge** button (white, `1px #ece9f5` border, `#6c6890`) and a contextual **handoff** button (bg = next column accent@18%, text = next column deep). Handoff label depends on current column: local→"Assign to Support", hq→"Hand to SRE", sanity→"Send to user", before-resolved→"Resolve". Resolved cards show no handoff button.

Clicking a card body opens the **detail drawer**. Nudge/handoff buttons `stopPropagation`.

---

## View 2: Shifts

"Who's on, who's next" + weekly rota.

- **Two team panels** side by side (flex, gap `14px`, each `flex: 1`, `min-width: 300px`): white, rounded-`18px`, padding `20px 22px`, shadow, **top border `4px` solid** in team color (Support `#f093bd`, SRE `#5fc8be`).
  - Label "SUPPORT" / "SRE" (`10.5px`, `700`, letter-spacing `.05em`, `#a29ebb`).
  - "ON SHIFT NOW" row: `54px` avatar + a deep-colored `10.5px` `700` "ON SHIFT NOW" label, name (`18px`, `700`, `#2e2a47`), "until {time}" (`12px`, `#a29ebb`). Support deep `#b65389`, SRE deep `#2f877f`.
  - Divider (`1px #f3f1fa`), then "Up next: {name}" with a `32px` avatar.
  - Prototype data: Support on = Maya R. until 4:00 PM, next = Priya K.; SRE on = Devon L. until 6:00 PM, next = Sam T.
- **Rota card**: white rounded-`18px` padding `22px`. Heading "THIS WEEK'S ROTA". A CSS grid `grid-template-columns: 92px repeat(7, 1fr)`, gap `12px 10px`. Row 1: empty cell + 7 day labels (Mon–Sun, `11.5px`, `700`, `#a29ebb`, centered). Row 2: "Support" label (`#b65389`) + 7 `30px` avatars. Row 3: "SRE" label (`#2f877f`) + 7 `30px` avatars.
  - Prototype rota — Support: Maya, Priya, Alex, Maya, Priya, Alex, Maya. SRE: Devon, Sam, Devon, Sam, Devon, Sam, Devon.

---

## View 3: Owners

Case load by teammate. CSS grid `repeat(auto-fill, minmax(310px, 1fr))`, gap `14px`. One card per teammate (order: Alex/you, Maya, Priya, Devon, Sam). Card: white, rounded-`18px`, padding `18px`, border `1px #f3f1fa`, shadow; hover `translateY(-2px)` + shadow. **Clicking a card** navigates to Board with filter set to that owner (`own:<id>`).

Card contents:
- Header row: `46px` avatar (teammate color, white initials); name (`15px`, `700`, `#2e2a47`); team chip below (Support deep `#b65389`, SRE deep `#2f877f`, bg = that color@13%, `10.5px`, `700`); spacer; right-aligned open-count (`26px`, `800`, team-deep color, or `#cdc9dc` if zero) with "open" label under it.
- Body: list of that owner's open (non-Resolved) cases — each a `8px` rounded accent dot (column accent) + truncated case title (`12.5px`, `500`, `#4a4665`, single-line ellipsis). If none: "All clear — no open cases 🎉".

---

## View 4: Weekly Archive

Resolved cases, by week.

- **Three summary cards** (flex, gap `12px`, min-width `180px`): white rounded-`16px` padding `16px 18px`. Big value (`30px`, `800`) + label (`12px`, `600`, `#a29ebb`).
  - "Resolved this week" = count of Resolved cards, value color `#429a72`.
  - "Avg time to resolve" = "1.8d", color `#6857c0`.
  - "Handoffs this week" = 38, color `#2f877f`.
- **Resolved this week** card: white rounded-`18px` padding `20px`, heading "RESOLVED THIS WEEK". List of resolved cases — each a `34px` owner avatar + title (`13.5px`, `600`, ellipsis) + mono "{code} · closed by {name}" subline + a "✓ Resolved" chip (text `#429a72`, bg `#e7f5ed`, `11.5px`, `700`).
- **Previous weeks** card: heading "PREVIOUS WEEKS". Rows of: week label (`128px` fixed, `13px`, `600`, `#4a4665`) + a horizontal bar track (`11px` tall, bg `#f3f1fa`, rounded `6px`) with a fill `linear-gradient(90deg, #ab9ef1, #80cba7)` whose width = count / max-count × 100% + "{count} cases" (`13px`, `700`, right-aligned `74px`).
  - Prototype data: Jun 2–8 = 14, May 26–Jun 1 = 11, May 19–25 = 9, May 12–18 = 12.

---

## Detail Drawer (opens from a Board card)

A right-side panel over a `rgba(46,42,71,.32)` backdrop (with `backdrop-filter: blur(2px)`); panel `436px` wide (`max-width: 94vw`), full height, bg `#fbfaff`, shadow `-22px 0 60px rgba(46,42,71,.24)`. Click backdrop to close; clicks inside `stopPropagation`.

- **Header**: mono code, optional priority pill, spacer, ✕ close button (`30px`, `#f6f4fb`).
- **Body** (scrollable, padding `20px`):
  - Title (`18px`, `700`, `#2e2a47`).
  - Meta row: column chip (text = column deep, bg = accent@20%), owner (mini avatar + name), mono "updated {time}".
  - If viewers present: a `#efeafc` banner, pulsing `#ab9ef1` dot + "{names} {is/are} viewing now" (`#6857c0`).
  - **Lifecycle** card: 4 stages (New, Local Team, HQ Team, Sanity Check) as a horizontal stepper. Each: a `28px` circle + label. Completed = `#80cba7` with white "✓"; active = column accent with `0 0 0 4px {accent@18%}` ring; future = `#eceaf3` with muted label.
  - **Actions**: "👋 Nudge for update" (white outline button) + contextual handoff button (next-column accent@20% bg, next-column deep text).
  - **Conversation**: heading "CONVERSATION", then a thread. Two message kinds:
    - *System*: centered gray pill, e.g. "You moved this to HQ Team · {time}", "👋 You nudged Devon for an update · {time}".
    - *Normal*: `30px` author avatar + name + team chip (team-color@16% bg) + time, with the body in a white bordered bubble (`13.5px`, line-height `1.5`, `#4a4665`).
- **Composer** (footer, white, `1px #f3f1fa` top border): text input ("Message the team…  @ to mention") + gradient **Send** button. Enter or Send posts the comment as the current user ("Alex (you)").

---

## Compose Modal (+ New case)

Centered modal over `rgba(46,42,71,.4)` blurred backdrop. White, `440px` wide, rounded-`20px`, padding `24px`, shadow `0 30px 70px rgba(46,42,71,.3)`.
- Title "New case" (`18px`, `800`); subtitle "It lands in **New** for triage."
- **Title** text input.
- **Priority** select: 🔥 Urgent / High / Normal (default Normal).
- Footer: "Cancel" (`#f6f4fb` button) + "Create case" (gradient button).
- On create: validates non-empty title; prepends a new card to **New** with id `CG-{nextNum}` (counter starts 4822, increments), shows a success toast. Empty title → toast "Add a short title first".

## Toast
Bottom-center, `#2e2a47` pill, white `600` `13.5px` text, padding `12px 20px`, radius `13px`, shadow `0 12px 32px rgba(46,42,71,.36)`, a `7px` `#88dcc0` dot. Auto-dismisses after ~2.6s.

---

## Interactions & Behavior

- **Drag-and-drop handoff**: cards are `draggable`. Drop on any column → moves the card there (`updated` resets to 0), appends a system comment "You moved this to {column}", increments the Handoffs-today counter, and shows a toast. Drag-over highlights the target column (inset accent ring + tint). Dropping on the same column is a no-op.
- **One-click handoff**: the card/drawer handoff button advances the ticket to the **next** lifecycle column (same side effects as a drop).
- **Nudge**: appends a system comment "👋 You nudged {owner} for an update" and toasts "Nudge sent to {owner} — they got a ping".
- **Open drawer**: clicking a card sets `selectedId`.
- **Post comment**: Enter or Send appends a comment authored by "you" with time "just now".
- **Filters**: clicking a filter pill (or the Stuck / Awaiting stat cards) sets the active filter; cards are filtered in place. Owner cards set an `own:<id>` filter and switch to Board.
- **Theme switch**: toggles Pop / Refined / Bold; recolors columns, page bg, and sidebar (Bold makes the sidebar `#1c1838` and page `#141229`).
- **Live presence (simulated)**: every 5s a random teammate is assigned to "view" a random open card, surfacing the 👀 viewer badge and the drawer's "viewing now" banner. In production, replace with real presence (websocket/SSE).

### Business rules
- **Stuck** = `updated >= 180` minutes AND column is `local` or `hq`. (Tickets idle on a team for 3h+.)
- **Open** = any column except `resolved`.
- Time formatting: `<1m` → "just now"; `<60m` → "{m}m ago"; `<1440m` → "{h}h ago"; else "{d}d ago".

## State Management
Single source of truth is a list of cards. Each card: `{ id, col, title, priority, owner, updated (minutes ago), comments[] }`. Comment: `{ id, who | system, text, min }`.
Other UI state: `theme`, `view` (board/shifts/owners/archive), `filter`, `selectedId` (open drawer), `draggingId`, `dragOverCol`, `toast`, `composeOpen`, `nextNum`, `handoffsToday`, `roam` (presence). Shifts/Owners/Archive views are **derived** from the card list (plus static rota/archive-week sample data) — no separate stores.
In production, the card list and comments come from your ticketing backend; presence and "online" come from a realtime channel.

## Design Tokens

**Teammate avatar colors**: Alex `#ec84ad`, Maya `#f0a7c6`, Priya `#e98fb4` (Support); Devon `#5cc3b9`, Sam `#74c3d0` (SRE); Customer/User `#ab9ef1`.

**Column palette**: see the Columns table (accent / deep / tint per stage).

**Priority**: Urgent `#fbe0e5`/`#cf6a7c`, High `#fbecd0`/`#b9842f`. **Stuck** `#fbe9da`/`#d98a5c`. **Resolved/positive green** `#80cba7` (deep `#429a72`).

**Neutrals**: ink `#2e2a47` / `#28244a`; body `#4a4665`; secondary `#6c6890`; muted `#9591ad` / `#a29ebb` / `#aaa6c0`; hairline borders `#f0eef7` / `#f1eff7` / `#f3f1fa`; chip bg `#f4f2fa` / `#f6f4fb` / `#f7f5fc`. Lavender active/selection bg `#efeafc`, lavender accent `#ab9ef1`, lavender deep `#6857c0`.

**Gradients**: brand/buttons `linear-gradient(135deg, #9b8aed, #ec84ad)`; logo `linear-gradient(135deg, #a99cf0 0%, #f093bd 60%, #7fd0c6 125%)`; archive bars `linear-gradient(90deg, #ab9ef1, #80cba7)`.

**Radii**: cards/panels `14–20px`; pills/buttons `8–13px`; chips `6–9px`; avatars `50%`.

**Shadows**: card `0 1px 2px rgba(24,20,52,.04), 0 5px 16px rgba(24,20,52,.05)`; panel `0 1px 3px rgba(24,20,52,.06)`; modal `0 30px 70px rgba(46,42,71,.3)`; drawer `-22px 0 60px rgba(46,42,71,.24)`.

**Typography scale** (Plus Jakarta Sans): page title `18/800`; section value `21–30/800`; card/owner title `13.5–15/600–700`; body `13.5/400–500`; labels `10.5–12/600–700`; mono meta `11–12/500–600` (JetBrains Mono).

**Spacing**: common gaps `8 / 10 / 12 / 14 / 15 / 16px`; card padding `13–22px`; sidebar `236px`; content max-width `1260px`; columns `286–300px`.

## Assets
No raster image assets. Icons are Unicode emoji (🗂️ 🗓️ 👥 🗄️ 📋 ⏱ 👤 🔁 🟢 🔥 👋 👀 💬 ✓). In a production codebase, swap these for your existing icon set (e.g. Lucide/Phosphor) to match house style; emoji were used only to keep the prototype dependency-free. Fonts: Plus Jakarta Sans + JetBrains Mono (Google Fonts) — substitute your app's families if different.

## Files
- `CommuGround.dc.html` — the full interactive prototype (all four views, drawer, modal, themes, drag-and-drop, simulated presence). Open in a browser to interact. Read the `Component` logic class near the bottom for exact behavior and the sample dataset.
