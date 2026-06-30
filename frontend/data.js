// Seed data for the Case Tracker prototype — RAW Case Center records.
//
// Each entry below is one raw Case Center record (the same shape `fetch_raw()` in
// local/casecenter.py returns from a real Case Center query). At boot the app runs
// every record through `mapRawCcRecord()` + `fillBoardDefaults()` (see app.js) so
// the renderers always receive the board shape they expect — `status` enum,
// `priority`, `caseLink`, `processTimeline` with mapped status, derived
// `assigneeDept`, etc. Keep this file as raw CC; do not pre-map.
//
// Lookups consulted by the mapper (mirrors local/casecenter.py):
//   caseStatus values:           Open · In-Progress · Wait Resolution · Close · Drop
//   subStatus.transition values: Wait User · Return · null
//   caseLevel:                   Urgent (→ high) · Normal (→ medium)
//   processType:                 "1st  Line" (two spaces) · "Service Team" · others
//
// `processorDeptName` strings are matched against the `owners.js` rows so the
// Route Board's dept → station lookup resolves (Core Team / HQ / User).
//
// `window.SEED_AGENT_LAYER` overlays the operator-side fields onto specific
// cases after mapping (picks + Track Statuses + a sample handover note) so the
// Picked workspace + Route Board demo meaningfully on first load.

window.NOW = new Date('2026-06-12T13:00:00Z');

window.THRESHOLDS = {
  coreIdleHours: 4,
  hqIdleHours: 8,
  approachingSlaHours: 20,
  shiftEndingSoonMinutes: 60,
  itProcessHours: 15,   // IT process time (1st Line + Service Team + 2nd Line + Unknown) over this → highlight
};

window.CURRENT_SHIFT = { name: 'Day', endsAtUtc: '2026-06-12T12:00:00Z', date: '2026-06-12' };
// Week boundaries: weeks start on SUNDAY 00:00 UTC. W24 of 2026 starts Sun Jun 7.
// NOTE: these are authoring-time defaults. On boot, app.js re-anchors the seed onto the real
// clock and `syncWeeksToNow()` rebuilds WEEKS + CURRENT_WEEK so "this week" tracks today's date.
window.CURRENT_WEEK = { id: 'W24-2026', label: 'W24 · June 7 – 13, 2026', startsAt: '2026-06-07T00:00:00Z' };

window.WEEKS = [
  { id: 'W27-2026', label: 'W27 · June 28 – July 4, 2026', startsAt: '2026-06-28T00:00:00Z', endsAt: '2026-07-05T00:00:00Z', isFuture: true },
  { id: 'W26-2026', label: 'W26 · June 21 – 27, 2026',    startsAt: '2026-06-21T00:00:00Z', endsAt: '2026-06-28T00:00:00Z', isFuture: true },
  { id: 'W25-2026', label: 'W25 · June 14 – 20, 2026',    startsAt: '2026-06-14T00:00:00Z', endsAt: '2026-06-21T00:00:00Z', isFuture: true },
  { id: 'W24-2026', label: 'W24 · June 7 – 13, 2026',     startsAt: '2026-06-07T00:00:00Z', endsAt: '2026-06-14T00:00:00Z', isCurrent: true },
  { id: 'W23-2026', label: 'W23 · May 31 – June 6, 2026', startsAt: '2026-05-31T00:00:00Z', endsAt: '2026-06-07T00:00:00Z' },
];

// Tell app.js to treat window.CASES as raw Case Center records and run them
// through mapRawCcRecord() at boot.
window.CASES_RAW_CC = true;

// ---- Curated raw Case Center records (C-2401 … C-2410) -------------------
//
// These 10 hand-authored records cover the tricky scenarios; ~28 more are
// appended by the factory below (C-2411…C-2438) to fill out the board. Coverage:
//   2 × Open / triage (New column)
//   2 × Service Team (With Core Team)
//   2 × Wait Resolution (With HQ Product Team)
//   1 × In-Progress + Wait User (Returned to requester)
//   1 × In-Progress + Return (back to triage from the requester)
//   1 × Close (closed)
//   1 × Drop (cancelled)

window.CASES = [

  // -- C-2401 — Open at Site IT (fresh New) --------------------------
  {
    caseId: 'C-2401',
    subject: 'APAC users locked out after MFA reset',
    caseStatus: 'Open',
    subStatus: { transition: null },
    caseLevel: 'Urgent',
    caseType: 'access',
    userAccount: 'hana.park',
    userName: 'Hana Park',
    userDept: 'APAC Sales',
    reporter: 'helpdesk-tier1',
    assignee: 'helpdesk-tier1',
    caseLink: 'https://case-center.example/CC-2401',
    createDateTime: '2026-06-12T05:12:00+00:00',
    processTimeline: [
      {
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-12T05:12:00Z', processEndTime: null, processMinutes: null,
      },
    ],
  },

  // -- C-2402 — In-Progress, last stage "1st Line" (still New) ---------------
  // Picked + tracked as Weekend Case in SEED_AGENT_LAYER below.
  {
    caseId: 'C-2402',
    subject: 'Weekend outage: Slack outbound webhooks silent',
    caseStatus: 'In-Progress',
    subStatus: { transition: null },
    caseLevel: 'Urgent',
    caseType: 'service',
    userAccount: 'cheng.liu',
    userName: 'Cheng Liu',
    userDept: 'APAC Engineering',
    reporter: 'helpdesk-tier1',
    assignee: 'helpdesk-tier1',
    caseLink: 'https://case-center.example/CC-2402',
    createDateTime: '2026-06-12T10:30:00+00:00',
    processTimeline: [
      {
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
        caseStatus: 'In-Progress', subStatus: { transition: null },
        processStartTime: '2026-06-12T10:30:00Z', processEndTime: null, processMinutes: null,
      },
    ],
  },

  // -- C-2403 — In-Progress, last stage "Service Team" (With Core Team) ------
  {
    caseId: 'C-2403',
    subject: 'Login fails sporadically — APAC region',
    caseStatus: 'In-Progress',
    subStatus: { transition: null },
    caseLevel: 'Normal',
    caseType: 'access',
    userAccount: 'wei.zhang',
    userName: 'Wei Zhang',
    userDept: 'APAC Sales',
    reporter: 'helpdesk-tier1',
    assignee: 'core-apac-eng',
    caseLink: 'https://case-center.example/CC-2403',
    createDateTime: '2026-06-11T22:00:00+00:00',
    processTimeline: [
      {
        // Transient "Unknown" stage at intake — skipped by latestProcessType().
        processType: 'Unknown', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-11T21:55:00Z', processEndTime: '2026-06-11T22:00:00Z', processMinutes: 5,
      },
      {
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-11T22:00:00Z', processEndTime: '2026-06-11T22:30:00Z', processMinutes: 30,
      },
      {
        processType: 'Service Team', processor: 'core-apac-eng', processorDeptName: 'Site IT',
        caseStatus: 'In-Progress', subStatus: { transition: null },
        processStartTime: '2026-06-11T22:30:00Z', processEndTime: null, processMinutes: null,
      },
    ],
  },

  // -- C-2404 — In-Progress, last stage "Service Team" (With Core Team) ------
  {
    caseId: 'C-2404',
    subject: 'Bulk export from Reports stalls at 80%',
    caseStatus: 'In-Progress',
    subStatus: { transition: null },
    caseLevel: 'Normal',
    caseType: 'data',
    userAccount: 'marcus.odonnell',
    userName: 'Marcus O’Donnell',
    userDept: 'EMEA Sales',
    reporter: 'helpdesk-tier1',
    assignee: 'core-emea-eng',
    caseLink: 'https://case-center.example/CC-2404',
    createDateTime: '2026-06-11T13:00:00+00:00',
    processTimeline: [
      {
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-11T13:00:00Z', processEndTime: '2026-06-11T13:30:00Z', processMinutes: 30,
      },
      {
        processType: 'Service Team', processor: 'core-emea-eng', processorDeptName: 'Site IT',
        caseStatus: 'In-Progress', subStatus: { transition: null },
        processStartTime: '2026-06-11T13:30:00Z', processEndTime: null, processMinutes: null,
      },
    ],
  },

  // -- C-2405 — Wait Resolution (With HQ Product Team) -----------------------
  // Picked + tracked as Sanity Check in SEED_AGENT_LAYER below.
  {
    caseId: 'C-2405',
    subject: 'Mobile push notifications missing for iOS 18.4',
    caseStatus: 'Wait Resolution',
    subStatus: { transition: null },
    caseLevel: 'Normal',
    caseType: 'mobile',
    userAccount: 'ana.souza',
    userName: 'Ana Souza',
    userDept: 'AMER Customer Success',
    reporter: 'helpdesk-tier1',
    assignee: 'hq-mobile-eng',
    caseLink: 'https://case-center.example/CC-2405',
    createDateTime: '2026-06-09T15:00:00+00:00',
    processTimeline: [
      {
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-09T15:00:00Z', processEndTime: '2026-06-09T15:30:00Z', processMinutes: 30,
      },
      {
        processType: 'Service Team', processor: 'core-amer-eng', processorDeptName: 'Site IT',
        caseStatus: 'In-Progress', subStatus: { transition: null },
        processStartTime: '2026-06-09T15:30:00Z', processEndTime: '2026-06-10T01:00:00Z', processMinutes: 570,
      },
      {
        processType: 'Product fix', processor: 'hq-mobile-eng', processorDeptName: 'HQ Mobile',
        caseStatus: 'Wait Resolution', subStatus: { transition: null },
        processStartTime: '2026-06-10T01:00:00Z', processEndTime: null, processMinutes: null,
      },
    ],
  },

  // -- C-2406 — Wait Resolution (With HQ Product Team) -----------------------
  // Picked + tracked as Sanity Check in SEED_AGENT_LAYER below.
  {
    caseId: 'C-2406',
    subject: 'SAML SSO loop after IdP cert rotation',
    caseStatus: 'Wait Resolution',
    subStatus: { transition: null },
    caseLevel: 'Urgent',
    caseType: 'access',
    userAccount: 'priya.sharma',
    userName: 'Priya Sharma',
    userDept: 'AMER Sales',
    reporter: 'helpdesk-tier1',
    assignee: 'hq-identity-eng',
    caseLink: 'https://case-center.example/CC-2406',
    createDateTime: '2026-06-10T17:00:00+00:00',
    processTimeline: [
      {
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-10T17:00:00Z', processEndTime: '2026-06-10T17:30:00Z', processMinutes: 30,
      },
      {
        processType: 'Service Team', processor: 'core-amer-eng', processorDeptName: 'Site IT',
        caseStatus: 'In-Progress', subStatus: { transition: null },
        processStartTime: '2026-06-10T17:30:00Z', processEndTime: '2026-06-11T01:00:00Z', processMinutes: 450,
      },
      {
        processType: 'Escalation', processor: 'hq-identity-eng', processorDeptName: 'HQ Identity',
        caseStatus: 'Wait Resolution', subStatus: { transition: null },
        processStartTime: '2026-06-11T01:00:00Z', processEndTime: null, processMinutes: null,
      },
    ],
  },

  // -- C-2407 — In-Progress + Wait User (Returned to requester) --------------
  {
    caseId: 'C-2407',
    subject: 'Unknown error in Reports v3 — need requester repro',
    caseStatus: 'In-Progress',
    subStatus: {
      transition: 'Wait User',
      reason: 'Awaiting reproduction steps from requester',
      dueAction: 'Requester to attach error logs + repro steps',
      dueDateTime: '2026-06-12T10:00:00+00:00',
      transitionDateTime: '2026-06-11T14:00:00+00:00',
      lastProcessor: { assignee: 'core-emea-eng', handlerType: 'Core Team' },
    },
    caseLevel: 'Normal',
    caseType: 'data',
    userAccount: 'liam.walsh',
    userName: 'Liam Walsh',
    userDept: 'EMEA Operations',
    reporter: 'helpdesk-tier1',
    assignee: 'liam.walsh',  // returned to the user
    caseLink: 'https://case-center.example/CC-2407',
    createDateTime: '2026-06-09T09:00:00+00:00',
    processTimeline: [
      {
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-09T09:00:00Z', processEndTime: '2026-06-09T09:30:00Z', processMinutes: 30,
      },
      {
        processType: 'Service Team', processor: 'core-emea-eng', processorDeptName: 'Site IT',
        caseStatus: 'In-Progress', subStatus: { transition: null },
        processStartTime: '2026-06-09T09:30:00Z', processEndTime: '2026-06-11T14:00:00Z', processMinutes: 3150,
      },
      {
        processType: 'User', processor: 'liam.walsh', processorDeptName: 'EMEA Operations',
        caseStatus: 'In-Progress', subStatus: { transition: 'Wait User' },
        processStartTime: '2026-06-11T14:00:00Z', processEndTime: null, processMinutes: null,
      },
    ],
  },

  // -- C-2408 — In-Progress + Return (user replied; back to triage as New) ---
  {
    caseId: 'C-2408',
    subject: 'Requester replied after VPN cert reset — fresh look needed',
    caseStatus: 'In-Progress',
    subStatus: { transition: 'Return' },
    caseLevel: 'Normal',
    caseType: 'network',
    userAccount: 'elena.rossi',
    userName: 'Elena Rossi',
    userDept: 'EMEA Finance',
    reporter: 'helpdesk-tier1',
    assignee: 'helpdesk-tier1',
    caseLink: 'https://case-center.example/CC-2408',
    createDateTime: '2026-06-11T08:30:00+00:00',
    processTimeline: [
      {
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-11T08:30:00Z', processEndTime: '2026-06-11T09:00:00Z', processMinutes: 30,
      },
      {
        processType: 'User', processor: 'elena.rossi', processorDeptName: 'EMEA Finance',
        caseStatus: 'In-Progress', subStatus: { transition: 'Wait User' },
        processStartTime: '2026-06-11T09:00:00Z', processEndTime: '2026-06-12T11:00:00Z', processMinutes: 1560,
      },
      {
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
        caseStatus: 'In-Progress', subStatus: { transition: 'Return' },
        processStartTime: '2026-06-12T11:00:00Z', processEndTime: null, processMinutes: null,
      },
    ],
  },

  // -- C-2409 — Closed --------------------------------------------------------
  {
    caseId: 'C-2409',
    subject: 'Password reset email delayed — resolved',
    caseStatus: 'Close',
    subStatus: { transition: null },
    caseLevel: 'Normal',
    caseType: 'access',
    userAccount: 'tom.becker',
    userName: 'Tom Becker',
    userDept: 'EMEA Marketing',
    reporter: 'helpdesk-tier1',
    assignee: 'hq-identity-eng',
    caseLink: 'https://case-center.example/CC-2409',
    createDateTime: '2026-06-08T14:00:00+00:00',
    processTimeline: [
      {
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-08T14:00:00Z', processEndTime: '2026-06-08T14:30:00Z', processMinutes: 30,
      },
      {
        processType: 'Service Team', processor: 'core-emea-eng', processorDeptName: 'Site IT',
        caseStatus: 'In-Progress', subStatus: { transition: null },
        processStartTime: '2026-06-08T14:30:00Z', processEndTime: '2026-06-08T19:00:00Z', processMinutes: 270,
      },
      {
        processType: 'Product fix', processor: 'hq-identity-eng', processorDeptName: 'HQ Identity',
        caseStatus: 'Wait Resolution', subStatus: { transition: null },
        processStartTime: '2026-06-08T19:00:00Z', processEndTime: '2026-06-09T13:00:00Z', processMinutes: 1080,
      },
      {
        processType: 'Closing', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
        caseStatus: 'Close', subStatus: { transition: null },
        processStartTime: '2026-06-09T13:00:00Z', processEndTime: '2026-06-09T13:15:00Z', processMinutes: 15,
      },
    ],
  },

  // -- C-2410 — Dropped (cancelled) ------------------------------------------
  {
    caseId: 'C-2410',
    subject: 'Duplicate of CC-2407 — cancelled',
    caseStatus: 'Drop',
    subStatus: { transition: null },
    caseLevel: 'Normal',
    caseType: 'data',
    userAccount: 'liam.walsh',
    userName: 'Liam Walsh',
    userDept: 'EMEA Operations',
    reporter: 'helpdesk-tier1',
    assignee: 'helpdesk-tier1',
    caseLink: 'https://case-center.example/CC-2410',
    createDateTime: '2026-06-08T11:00:00+00:00',
    processTimeline: [
      {
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-08T11:00:00Z', processEndTime: '2026-06-08T12:00:00Z', processMinutes: 60,
      },
      {
        processType: 'Closing', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
        caseStatus: 'Drop', subStatus: { transition: null },
        processStartTime: '2026-06-08T12:00:00Z', processEndTime: '2026-06-08T12:10:00Z', processMinutes: 10,
      },
    ],
  },

];

// ---- Generated bulk cases (C-2411 … C-2438) ---------------------------------
//
// The 10 curated records above cover the tricky scenarios (Wait User, Return,
// Close, Drop, full escalation chains). This block adds ~28 more raw CC records
// — same shape, built by a small factory — so the board, archive and Route Board
// look realistic when seeded into a real DB for testing. Most land in the current
// week (W24); the tail are closed/dropped cases in the prior week (W23) to fill
// the Weekly Archive. Timestamps are anchored off window.NOW like everything else.
window.CASES = window.CASES.concat((function () {
  const base = window.NOW.getTime();
  const H = 3600e3, D = 24 * H;
  const iso = msAgo => new Date(base - msAgo).toISOString();
  const desk = { processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'Site IT' };
  const cores = [
    { dept: 'Site IT', proc: 'core-apac-eng' },
    { dept: 'Site IT', proc: 'core-emea-eng' },
    { dept: 'Site IT', proc: 'core-amer-eng' },
  ];
  const hqs = [
    { dept: 'HQ Identity', proc: 'hq-identity-eng', ptype: 'Escalation' },
    { dept: 'HQ Identity', proc: 'hq-data-eng',     ptype: 'Product fix' },
    { dept: 'HQ Mobile',    proc: 'hq-mobile-eng',   ptype: 'Product fix' },
  ];
  const users = [
    { account: 'noah.kim',     name: 'Noah Kim',       dept: 'APAC Sales' },
    { account: 'yuki.mori',    name: 'Yuki Mori',      dept: 'APAC Engineering' },
    { account: 'sofia.costa',  name: 'Sofia Costa',    dept: 'EMEA Sales' },
    { account: 'mateo.garcia', name: 'Mateo García',   dept: 'AMER Sales' },
    { account: 'fatima.noor',  name: 'Fatima Noor',    dept: 'EMEA Operations' },
    { account: 'daniel.weiss', name: 'Daniel Weiss',   dept: 'EMEA Finance' },
    { account: 'grace.lee',    name: 'Grace Lee',      dept: 'APAC Customer Success' },
    { account: 'oliver.smith', name: 'Oliver Smith',   dept: 'AMER Marketing' },
    { account: 'aisha.rahman', name: 'Aisha Rahman',   dept: 'EMEA Marketing' },
    { account: 'lucas.silva',  name: 'Lucas Silva',    dept: 'AMER Operations' },
    { account: 'mina.takagi',  name: 'Mina Takagi',    dept: 'APAC Finance' },
    { account: 'emma.brown',   name: 'Emma Brown',     dept: 'AMER Customer Success' },
    { account: 'raj.patel',    name: 'Raj Patel',      dept: 'APAC IT' },
    { account: 'nora.haddad',  name: 'Nora Haddad',    dept: 'EMEA Engineering' },
    { account: 'leo.martin',   name: 'Leo Martin',     dept: 'AMER Engineering' },
    { account: 'yara.kassab',  name: 'Yara Kassab',    dept: 'EMEA Customer Success' },
  ];

  let n = 2411;
  function make(scenario, subject, user, level, type, ago, core, hq) {
    const id = 'C-' + (n++);
    const rec = {
      caseId: id, subject, caseStatus: 'Open', subStatus: { transition: null },
      caseLevel: level, caseType: type,
      userAccount: user.account, userName: user.name, userDept: user.dept,
      reporter: 'helpdesk-tier1', assignee: 'helpdesk-tier1',
      caseLink: 'https://case-center.example/CC-' + id.slice(2),
      createDateTime: iso(ago), processTimeline: [],
    };
    const open = { ...desk, caseStatus: 'Open', subStatus: { transition: null },
      processStartTime: iso(ago), processEndTime: iso(ago - 0.5 * H), processMinutes: 30 };
    if (scenario === 'new_open') {
      rec.caseStatus = 'Open';
      rec.processTimeline = [{ ...desk, caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: iso(ago), processEndTime: null, processMinutes: null }];
    } else if (scenario === 'triage_inprogress') {
      rec.caseStatus = 'In-Progress';
      rec.processTimeline = [{ ...desk, caseStatus: 'In-Progress', subStatus: { transition: null },
        processStartTime: iso(ago), processEndTime: null, processMinutes: null }];
    } else if (scenario === 'with_core') {
      rec.caseStatus = 'In-Progress'; rec.assignee = core.proc;
      rec.processTimeline = [open, { processType: 'Service Team', processor: core.proc, processorDeptName: core.dept,
        caseStatus: 'In-Progress', subStatus: { transition: null },
        processStartTime: iso(ago - 0.5 * H), processEndTime: null, processMinutes: null }];
    } else if (scenario === 'with_hq') {
      rec.caseStatus = 'Wait Resolution'; rec.assignee = hq.proc;
      rec.processTimeline = [open,
        { processType: 'Service Team', processor: core.proc, processorDeptName: core.dept,
          caseStatus: 'In-Progress', subStatus: { transition: null },
          processStartTime: iso(ago - 0.5 * H), processEndTime: iso(ago - 3 * H), processMinutes: 150 },
        { processType: hq.ptype, processor: hq.proc, processorDeptName: hq.dept,
          caseStatus: 'Wait Resolution', subStatus: { transition: null },
          processStartTime: iso(ago - 3 * H), processEndTime: null, processMinutes: null }];
    } else if (scenario === 'wait_user') {
      rec.caseStatus = 'In-Progress'; rec.assignee = user.account;
      rec.subStatus = { transition: 'Wait User', reason: 'Awaiting info from requester',
        dueAction: 'Requester to reply with details', dueDateTime: iso(ago - 1.5 * D),
        transitionDateTime: iso(ago - 1 * D), lastProcessor: { assignee: core.proc, handlerType: 'Core Team' } };
      rec.processTimeline = [open,
        { processType: 'Service Team', processor: core.proc, processorDeptName: core.dept,
          caseStatus: 'In-Progress', subStatus: { transition: null },
          processStartTime: iso(ago - 0.5 * H), processEndTime: iso(ago - 1 * D), processMinutes: 600 },
        { processType: 'User', processor: user.account, processorDeptName: user.dept,
          caseStatus: 'In-Progress', subStatus: { transition: 'Wait User' },
          processStartTime: iso(ago - 1 * D), processEndTime: null, processMinutes: null }];
    } else if (scenario === 'closed') {
      rec.caseStatus = 'Close'; rec.assignee = (hq || core).proc;
      rec.processTimeline = [open,
        { processType: 'Service Team', processor: core.proc, processorDeptName: core.dept,
          caseStatus: 'In-Progress', subStatus: { transition: null },
          processStartTime: iso(ago - 0.5 * H), processEndTime: iso(ago - 4 * H), processMinutes: 210 },
        { processType: 'Closing', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
          caseStatus: 'Close', subStatus: { transition: null },
          processStartTime: iso(ago - 4 * H), processEndTime: iso(ago - 4.25 * H), processMinutes: 15 }];
    } else if (scenario === 'dropped') {
      rec.caseStatus = 'Drop';
      rec.processTimeline = [open,
        { processType: 'Closing', processor: 'helpdesk-tier1', processorDeptName: 'Site IT',
          caseStatus: 'Drop', subStatus: { transition: null },
          processStartTime: iso(ago - 0.5 * H), processEndTime: iso(ago - 0.6 * H), processMinutes: 10 }];
    }
    return rec;
  }

  // [scenario, subject, level, type, daysAgo, coreIdx, hqIdx]
  const scen = [
    ['with_core', 'VPN drops every 30 minutes for AMER field team', 'Normal', 'network', 0.3, 2, 0],
    ['with_core', 'Shared mailbox not syncing on Outlook desktop', 'Urgent', 'service', 0.5, 1, 1],
    ['new_open', 'New starter cannot access HR portal', 'Normal', 'access', 0.2, 0, 0],
    ['with_hq', 'SSO token expiry too aggressive after policy change', 'Urgent', 'access', 1.2, 2, 0],
    ['wait_user', 'Dashboard widgets blank for Data Platform tenants', 'Normal', 'data', 2.1, 1, 1],
    ['wait_user', 'Spreadsheet macro fails — need a sample file', 'Normal', 'productivity', 1.0, 1, 0],
    ['new_open', 'Printer queue stuck across APAC office', 'Urgent', 'network', 0.4, 0, 0],
    ['with_core', 'Calendar invites arriving one hour off', 'Normal', 'mobile', 1.5, 0, 2],
    ['with_hq', 'Push notifications delayed on Android 15', 'Normal', 'mobile', 3.0, 0, 2],
    ['triage_inprogress', 'Requester chasing status on laptop replacement', 'Normal', 'service', 0.6, 0, 0],
    ['wait_user', 'Bulk user import rejects valid CSV rows', 'Urgent', 'data', 0.8, 1, 1],
    ['with_hq', 'MFA prompts loop on corporate WiFi', 'Urgent', 'access', 2.5, 2, 0],
    ['wait_user', 'App crash on export — awaiting logs', 'Normal', 'service', 1.3, 2, 2],
    ['wait_user', 'Teams screen-share freezes for EMEA', 'Normal', 'productivity', 2.0, 1, 1],
    ['new_open', 'Guest WiFi voucher portal returns 500', 'Normal', 'service', 0.25, 0, 0],
    ['with_hq', 'Report scheduler stopped emailing PDFs', 'Normal', 'data', 3.5, 1, 1],
    ['closed', 'Email signature template not applying — resolved', 'Normal', 'access', 4.0, 1, 0],
    ['with_core', 'Badge reader offline at AMER HQ lobby', 'Normal', 'network', 1.1, 2, 0],
    // ---- prior week (W23) history → Weekly Archive ----
    ['closed', 'Password reset link expired too quickly', 'Normal', 'access', 7.5, 1, 0],
    ['closed', 'OneDrive sync conflict on finance share', 'Normal', 'data', 8.2, 1, 1],
    ['dropped', 'Duplicate ticket for printer outage', 'Normal', 'network', 9.0, 0, 0],
    ['closed', 'Zoom plugin missing after update', 'Normal', 'productivity', 10.1, 2, 2],
    ['closed', 'SSO misconfig for new SaaS app', 'Urgent', 'access', 7.8, 2, 0],
    ['dropped', 'Spam report — no action needed', 'Normal', 'service', 11.0, 0, 0],
    ['closed', 'Mobile VPN profile expired', 'Normal', 'mobile', 8.9, 0, 2],
    ['closed', 'Data export encoding garbled', 'Normal', 'data', 12.0, 1, 1],
    ['closed', 'Meeting room display not detected', 'Normal', 'service', 9.5, 1, 0],
    ['closed', 'Account lockout after travel', 'Normal', 'access', 10.7, 2, 0],
  ];
  return scen.map((s, i) =>
    make(s[0], s[1], users[i % users.length], s[2], s[3], s[4] * D, cores[s[5]], hqs[s[6]]));
})());

// ---- Operator-layer overlay --------------------------------------------------
//
// Applied AFTER the CC mapping (see applySeedAgentLayer in app.js). Sits outside
// Case Center: picks (agentStatus = 'queued') and Track Statuses are operator
// intent, not CC fields. Spread across the Route Board lanes so all four demo:
//   MOVING  = weekend_case · escalate_to_core · hq_did_not_handle (scheduled handoff)
//   WATCH   = escalated_to_hq · need_to_contact_user (dashed ring pulse)
//   SANITY  = sanity_check (collapsible group)
//   STAY    = picked but untracked (parked at its station)

window.SEED_AGENT_LAYER = {
  // — MOVING lane (scheduled hand-off) — these sit AT USER and move toward their target —
  // `trackStatusAt` is the commit time the deadline anchors off (first scheduled slot AFTER it,
  // then it STICKS — see scheduledHandoff). Without it the chip would float with the clock.
  'C-2407': { agentStatus: 'queued', trackStatus: 'weekend_case',      trackStatusAt: '2026-06-11T12:00:00Z' }, // User → HQ (next Sun 17:30)
  'C-2416': { agentStatus: 'queued', trackStatus: 'hq_did_not_handle', trackStatusAt: '2026-06-12T10:00:00Z' }, // User → HQ (next 17:30)
  'C-2423': { agentStatus: 'queued', trackStatus: 'escalate_to_core',  trackStatusAt: '2026-06-15T17:00:00Z' }, // set Mon 10:00 MST → Core by Tue 09:00
  // — WATCH: escalated_to_hq (expected HQ) — one settled at HQ, one not yet (intent arrow → HQ) —
  'C-2414': { agentStatus: 'queued', trackStatus: 'escalated_to_hq',     // AT HQ → watch ring
    handover: { note: 'Pinged HQ Identity at 09:30 — awaiting a cert-rotation fix ETA. Keep watching; chase if nothing back by noon.',
      author: 'op-na', from: 'Night', to: 'Day', at: '2026-06-12T07:50:00Z', staleForCurrentShift: false } },
  'C-2412': { agentStatus: 'queued', trackStatus: 'escalated_to_hq' },    // at Core → intent arrow → HQ
  // — WATCH: need_to_contact_user (expected User) — one at User, one not (intent arrow → User) —
  'C-2421': { agentStatus: 'queued', trackStatus: 'need_to_contact_user' }, // AT User → watch ring
  'C-2422': { agentStatus: 'queued', trackStatus: 'need_to_contact_user' }, // at HQ → intent arrow → User
  // — SANITY (mostly at User; one elsewhere shows the fool-proof real-station behaviour) —
  'C-2415': { agentStatus: 'queued', trackStatus: 'sanity_check' },       // at User
  'C-2424': { agentStatus: 'queued', trackStatus: 'sanity_check' },       // at User
  'C-2405': { agentStatus: 'queued', trackStatus: 'sanity_check' },       // at HQ (real location shown)
  // — 1st-Line lane: picked but untracked → static dot + bidirectional dashed arrows —
  'C-2401': { agentStatus: 'queued' },
  // — STAY lane: picked, untracked, parked at its real station —
  'C-2418': { agentStatus: 'queued' },
};
