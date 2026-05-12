#!/usr/bin/env node
// Bundles the prototype into a single self-contained standalone.html so it
// can be opened directly via file:// without an HTTP server.
//
// Usage:  node prototype/bundle.mjs
//
// Reads index.html / styles.css / data.js / app.js / tour.js from this folder
// and writes prototype/standalone.html. The modular files remain the
// source of truth; re-run this script after editing them.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

function read(name) {
  return readFileSync(join(here, name), 'utf8');
}

const css = read('styles.css');
const data = read('data.js');
const app = read('app.js');
const tour = read('tour.js');
const indexHtml = read('index.html');

const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/);
if (!bodyMatch) {
  throw new Error('Could not find <body> in index.html');
}
const bodyContent = bodyMatch[1]
  .replace(/<script\s+src=["'][^"']+["'][^>]*><\/script>\s*/g, '')
  .trim();

const out = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Case Tracker — Prototype (standalone)</title>
<style>
${css}
</style>
</head>
<body>
${bodyContent}
<script>
${data}

${app}

${tour}
</script>
</body>
</html>
`;

writeFileSync(join(here, 'standalone.html'), out);
console.log(`Wrote ${join(here, 'standalone.html')} (${(out.length / 1024).toFixed(1)} KB)`);
