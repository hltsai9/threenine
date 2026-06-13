#!/usr/bin/env node
// Emit the demo seed as BOARD-SHAPED cases (the shape the API/DB store and the SPA render),
// wrapped as {"cases":[...]} — i.e. the exact body POST /api/save expects.
//
//   node backend/seed_board_json.cjs | \
//     curl -XPOST -H "Authorization: Bearer $API_AUTH_TOKEN" \
//          -H 'content-type: application/json' --data-binary @- https://<app>/api/save
//
// Unlike seed_extract.cjs (which prints the RAW Case Center records and relies on the Python
// ingest to map them), this runs the prototype's own mapper headlessly via the test loader, so
// it works with no Case Center access, no Python, and no shell on the server — handy for seeding
// a hosted DB (e.g. Render) from any machine that has this repo + node.
const path = require('node:path');
const { loadPrototype } = require(path.join(__dirname, '..', 'prototype', 'tests', 'load-prototype.cjs'));

const app = loadPrototype();                       // boots the SPA in a sandbox: maps + sanitises seed
const idField = app.CASES_RAW_CC ? 'caseId' : 'id';
const cases = app.CASES
  .map(r => app.caseById(String(r[idField])))      // raw id -> mapped, board-shaped case in STATE
  .filter(Boolean);

process.stdout.write(JSON.stringify({ cases }));
