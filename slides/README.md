# Promo deck — Case Tracker

`Case-Tracker-Overview.pptx` is an editable 16-slide PowerPoint promoting the Case Tracker
board (adoption pitch). It's generated, not hand-built, so it stays on-brand and reproducible.
Covers the Hand-off Route Board, the current-vs-desired (Case Center vs Track Status) model,
clocks/handover/reporting, and the deploy-it-for-your-team story.

## Regenerate

```bash
# one-time deps (installed into slides/node_modules — gitignored):
npm install --prefix slides pptxgenjs

# screenshots (optional — assets/*.png are committed; needs Playwright + Chromium):
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
