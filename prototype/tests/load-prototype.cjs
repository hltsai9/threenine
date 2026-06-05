// Zero-dependency loader for the prototype's pure functions.
//
// app.js is a browser SPA (no module exports) that runs boot()/render() at load and reads
// window.* globals. To unit-test its pure functions in Node without a browser, we evaluate
// data.js / shifts.js / owners.js / app.js inside a `vm` sandbox that provides just enough of
// a fake window + document for the file to load, and freeze Date to the seed clock so the
// time-shift offset is 0 and all NOW-relative math is deterministic.
//
// Returns the populated sandbox. Top-level `function` declarations in app.js (caseSlaMs,
// displayStatus, …) become sandbox properties; `window.*` globals (THRESHOLDS, CASES,
// CURRENT_OPERATOR_ID) are reachable because window === the sandbox. Note: `const`/`let`
// module bindings (STATE, NOW, HOUR) are NOT exposed — tests build their own inputs instead.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..'); // prototype/
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');

// A no-op DOM element: absorbs property writes and method calls so render() runs headless.
function noopEl() {
  const store = { textContent: '', innerHTML: '', value: '' };
  const noopFns = new Set([
    'addEventListener', 'removeEventListener', 'appendChild', 'removeChild', 'remove',
    'setAttribute', 'removeAttribute', 'scrollIntoView', 'focus', 'blur', 'click', 'select',
    'insertBefore', 'replaceChildren', 'append', 'prepend',
  ]);
  return new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (p === 'dataset') return (t.__ds || (t.__ds = {}));
      if (p === 'style') return (t.__st || (t.__st = {}));
      if (p === 'getBoundingClientRect') return () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
      if (p === 'querySelector') return () => noopEl();
      if (p === 'querySelectorAll') return () => [];
      if (p === 'closest') return () => null;
      if (noopFns.has(p)) return () => undefined;
      return undefined;
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

function makeDocument() {
  return {
    readyState: 'complete',
    getElementById: () => noopEl(),
    querySelector: () => noopEl(),
    querySelectorAll: () => [],
    createElement: () => noopEl(),
    createElementNS: () => noopEl(),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: noopEl(),
    head: noopEl(),
    documentElement: noopEl(),
  };
}

function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
  };
}

function loadPrototype() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  sandbox.console = console;
  sandbox.document = makeDocument();
  sandbox.localStorage = makeLocalStorage();
  sandbox.navigator = { clipboard: { writeText: () => Promise.resolve() } };
  sandbox.location = { hash: '#/cases', search: '', protocol: 'file:', href: 'file:///prototype/standalone.html' };
  sandbox.URLSearchParams = URLSearchParams;
  sandbox.structuredClone = structuredClone;
  // Timers are no-ops: boot()'s polling never runs, so the process can exit cleanly.
  sandbox.setTimeout = () => 0;
  sandbox.setInterval = () => 0;
  sandbox.clearTimeout = () => {};
  sandbox.clearInterval = () => {};
  sandbox.requestAnimationFrame = () => 0;
  sandbox.cancelAnimationFrame = () => {};
  sandbox.fetch = () => Promise.reject(new Error('no network in tests'));

  vm.createContext(sandbox);
  const run = (code, name) => vm.runInContext(code, sandbox, { filename: name });

  // 1) Browser data globals (context's native Date parses the seed ISO timestamps).
  run(read('data.js'), 'data.js');
  run(read('shifts.js'), 'shifts.js');
  run(read('owners.js'), 'owners.js');

  // 2) Freeze the clock to the seed's NOW so app.js's time-shift offset is 0 and every
  //    NOW-relative calculation is deterministic. FixedDate keeps arg-form parsing intact.
  const FIXED = sandbox.NOW.getTime();
  class FixedDate extends Date {
    constructor(...args) { if (args.length === 0) super(FIXED); else super(...args); }
    static now() { return FIXED; }
  }
  sandbox.Date = FixedDate;

  // 3) The app itself (runs boot()/render() once against the DOM shim).
  run(read('app.js'), 'app.js');

  sandbox.__FIXED__ = FIXED;
  sandbox.__HOUR__ = 3600 * 1000;
  return sandbox;
}

module.exports = { loadPrototype };
