# Prototype tests

Zero-dependency characterization tests for the pure functions in `frontend/app.js`. They lock
in current behavior so the planned refactors (see `docs/improvement-plan.md` §1, e.g. the
`PROMPT_HANDLERS` extraction) can be made safely.

## Run

```sh
node frontend/tests/run.cjs
```

Exit code is `0` when all tests pass, `1` otherwise. No npm install, no framework.

## How it works

`app.js` is a browser SPA with no module exports — it runs `boot()`/`render()` on load and reads
`window.*` globals. `load-prototype.cjs` evaluates `data.js`, `shifts.js`, `owners.js` and
`app.js` inside a Node `vm` sandbox with:

- a **minimal DOM shim** (no-op elements) so `render()` runs headless, and
- a **frozen `Date`** pinned to the seed's `NOW`, so app.js's seed time-shift offset is 0 and all
  `NOW`-relative math (`caseSlaMs`, `derivePromptsForCase`, …) is deterministic.

Top-level `function` declarations (`caseSlaMs`, `displayStatus`, `derivePromptsForCase`, …) become
sandbox properties; `const`/`let` module bindings (`STATE`, `NOW`, `HOUR`) are intentionally not
exposed, so tests construct their own inputs as offsets from the frozen clock.

## Covered today

`fmtDuration`, `statusLabel`, `displayStatus`, `isQueued`, `caseSlaMs`, `caseHoldMs`,
`derivePromptsForCase`, `needsHandoverNote`, `holderTotals` (the history-derived clock splits that
drive the First-line / FIT / HQ clocks), the `handlePrompt` action-handler outcomes, plus seed
structural sanity.

## Adding tests

Add `test('name', () => eq(actual, expected))` blocks in `run.cjs`. Use `iso(msAgo)` to build a
timestamp relative to the frozen now. If a future `app.js` change breaks headless loading, the
runner prints a clear pointer to `load-prototype.cjs` instead of a raw stack.
