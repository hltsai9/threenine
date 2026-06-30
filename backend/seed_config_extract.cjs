#!/usr/bin/env node
// Extract the shifts + owners config blocks from frontend/shifts.js and owners.js as JSON.
//
//   node backend/seed_config_extract.cjs [path/to/shifts.js] [path/to/owners.js]
//
// shifts.js / owners.js use JS-literal syntax (and shifts.js cross-references window.ROTA), so
// they can't be JSON.parsed. We evaluate both in one sandbox with a stub `window`, then print
// { shifts: {...}, owners: {...} } — the same payload shapes the SPA POSTs to /api/config/<key>
// (see shiftsConfig() / ownersConfig() in frontend/app.js). Used by
// `python -m backend.ingest --seed-config` to load the bundled roster + owners into the DB.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const proto = path.join(__dirname, '..', 'frontend');
const shiftsFile = process.argv[2] || path.join(proto, 'shifts.js');
const ownersFile = process.argv[3] || path.join(proto, 'owners.js');

const sandbox = { window: {}, Date, console };
vm.createContext(sandbox);
for (const f of [shiftsFile, ownersFile]) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
}

const w = sandbox.window;
// The prefixes var also accepts a single string for back-compat; normalise to an array.
const arr = v => Array.isArray(v) ? v : (typeof v === 'string' && v ? [v] : []);

const out = {
  shifts: {
    operators: w.OPERATORS || [],
    shifts: w.SHIFTS || [],
    currentOperatorId: w.CURRENT_OPERATOR_ID || '',
    rota: w.ROTA || [],
    rotaByWeek: w.ROTA_BY_WEEK || {},
  },
  owners: {
    owners: w.OWNERS || { core: [], hq: [] },
    ccCoreDepartments: arr(w.CC_CORE_DEPARTMENTS),
    ccHqDepartments: arr(w.CC_HQ_DEPARTMENTS),
    ccUserDepartments: arr(w.CC_USER_DEPARTMENTS),
    ccUserDepartmentPrefixes: arr(w.CC_USER_DEPARTMENT_PREFIXES),
  },
};
process.stdout.write(JSON.stringify(out));
