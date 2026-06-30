#!/usr/bin/env node
// Extract window.CASES from frontend/data.js as JSON on stdout.
//
//   node backend/seed_extract.cjs [path/to/data.js]
//
// data.js uses JS-literal object syntax (unquoted keys), so it can't be JSON.parsed.
// We evaluate it in a sandbox with a stub `window`, then print window.CASES. Used by
// `python -m backend.ingest --seed-from-data-js` to load demo data into the DB without
// any Case Center access.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const file = process.argv[2] || path.join(__dirname, '..', 'frontend', 'data.js');
const code = fs.readFileSync(file, 'utf8');
const sandbox = { window: {}, Date, console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: file });
process.stdout.write(JSON.stringify(sandbox.window.CASES || []));
