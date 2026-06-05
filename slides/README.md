# Promo deck — Case Tracker

`Case-Tracker-Overview.pptx` is an editable 14-slide PowerPoint promoting the Case Tracker
board (internal adoption pitch). It's generated, not hand-built, so it stays on-brand and
reproducible.

## Regenerate

```bash
# one-time deps (global; not committed)
npm install -g pptxgenjs            # deck builder
# (Playwright/Chromium already available at /opt/node22/lib/node_modules/playwright)

node slides/capture-screenshots.cjs # → slides/assets/*.png  (renders prototype/standalone.html)
node slides/build-deck.cjs          # → slides/Case-Tracker-Overview.pptx
```

- `capture-screenshots.cjs` drives headless Chromium over `prototype/standalone.html`
  (tour suppressed, 2× scale) and writes the PNGs in `assets/`.
- `build-deck.cjs` lays out the slides with `pptxgenjs`, embedding those PNGs and using the
  app's brand colors (`prototype/styles.css :root`).

Re-run both after UI changes so the screenshots stay current. Edit copy directly in
`build-deck.cjs` (slide blocks are in order) or in PowerPoint after generating.

## Notes
- Screenshots use the seed/demo data (live Case Center data is local-only); the "live data"
  slide uses a diagram instead of a screenshot.
- To export a PDF, open the `.pptx` and Save As PDF (LibreOffice headless conversion was not
  available in the build sandbox).
