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
};

window.CURRENT_SHIFT = { name: 'Day', endsAtUtc: '2026-06-12T12:00:00Z', date: '2026-06-12' };
// Week boundaries: weeks start on SUNDAY 00:00 UTC. W24 of 2026 starts Sun Jun 7.
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

// ---- 10 raw Case Center records for W24-2026 -----------------------------
//
// Coverage:
//   2 × Open / triage (New column)
//   2 × Service Team (With Core Team)
//   2 × Wait Resolution (With HQ Product Team)
//   1 × In-Progress + Wait User (Returned to requester)
//   1 × In-Progress + Return (back to triage from the requester)
//   1 × Close (closed)
//   1 × Drop (cancelled)

window.CASES = [

  // -- C-2401 — Open at IT Service Desk (fresh New) --------------------------
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
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'IT Service Desk',
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
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'IT Service Desk',
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
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'IT Service Desk',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-11T22:00:00Z', processEndTime: '2026-06-11T22:30:00Z', processMinutes: 30,
      },
      {
        processType: 'Service Team', processor: 'core-apac-eng', processorDeptName: 'Core Team — APAC desk',
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
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'IT Service Desk',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-11T13:00:00Z', processEndTime: '2026-06-11T13:30:00Z', processMinutes: 30,
      },
      {
        processType: 'Service Team', processor: 'core-emea-eng', processorDeptName: 'Core Team — EMEA desk',
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
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'IT Service Desk',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-09T15:00:00Z', processEndTime: '2026-06-09T15:30:00Z', processMinutes: 30,
      },
      {
        processType: 'Service Team', processor: 'core-amer-eng', processorDeptName: 'Core Team — AMER desk',
        caseStatus: 'In-Progress', subStatus: { transition: null },
        processStartTime: '2026-06-09T15:30:00Z', processEndTime: '2026-06-10T01:00:00Z', processMinutes: 570,
      },
      {
        processType: 'Product fix', processor: 'hq-mobile-eng', processorDeptName: 'HQ Mobile App',
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
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'IT Service Desk',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-10T17:00:00Z', processEndTime: '2026-06-10T17:30:00Z', processMinutes: 30,
      },
      {
        processType: 'Service Team', processor: 'core-amer-eng', processorDeptName: 'Core Team — AMER desk',
        caseStatus: 'In-Progress', subStatus: { transition: null },
        processStartTime: '2026-06-10T17:30:00Z', processEndTime: '2026-06-11T01:00:00Z', processMinutes: 450,
      },
      {
        processType: 'Escalation', processor: 'hq-identity-eng', processorDeptName: 'HQ Identity Team',
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
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'IT Service Desk',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-09T09:00:00Z', processEndTime: '2026-06-09T09:30:00Z', processMinutes: 30,
      },
      {
        processType: 'Service Team', processor: 'core-emea-eng', processorDeptName: 'Core Team — EMEA desk',
        caseStatus: 'In-Progress', subStatus: { transition: null },
        processStartTime: '2026-06-09T09:30:00Z', processEndTime: '2026-06-11T14:00:00Z', processMinutes: 3150,
      },
      {
        processType: 'Wait User', processor: 'liam.walsh', processorDeptName: 'EMEA Operations',
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
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'IT Service Desk',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-11T08:30:00Z', processEndTime: '2026-06-11T09:00:00Z', processMinutes: 30,
      },
      {
        processType: 'Wait User', processor: 'elena.rossi', processorDeptName: 'EMEA Finance',
        caseStatus: 'In-Progress', subStatus: { transition: 'Wait User' },
        processStartTime: '2026-06-11T09:00:00Z', processEndTime: '2026-06-12T11:00:00Z', processMinutes: 1560,
      },
      {
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'IT Service Desk',
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
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'IT Service Desk',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-08T14:00:00Z', processEndTime: '2026-06-08T14:30:00Z', processMinutes: 30,
      },
      {
        processType: 'Service Team', processor: 'core-emea-eng', processorDeptName: 'Core Team — EMEA desk',
        caseStatus: 'In-Progress', subStatus: { transition: null },
        processStartTime: '2026-06-08T14:30:00Z', processEndTime: '2026-06-08T19:00:00Z', processMinutes: 270,
      },
      {
        processType: 'Product fix', processor: 'hq-identity-eng', processorDeptName: 'HQ Identity Team',
        caseStatus: 'Wait Resolution', subStatus: { transition: null },
        processStartTime: '2026-06-08T19:00:00Z', processEndTime: '2026-06-09T13:00:00Z', processMinutes: 1080,
      },
      {
        processType: 'Closing', processor: 'helpdesk-tier1', processorDeptName: 'IT Service Desk',
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
        processType: '1st  Line', processor: 'helpdesk-tier1', processorDeptName: 'IT Service Desk',
        caseStatus: 'Open', subStatus: { transition: null },
        processStartTime: '2026-06-08T11:00:00Z', processEndTime: '2026-06-08T12:00:00Z', processMinutes: 60,
      },
      {
        processType: 'Closing', processor: 'helpdesk-tier1', processorDeptName: 'IT Service Desk',
        caseStatus: 'Drop', subStatus: { transition: null },
        processStartTime: '2026-06-08T12:00:00Z', processEndTime: '2026-06-08T12:10:00Z', processMinutes: 10,
      },
    ],
  },

];

// ---- Operator-layer overlay --------------------------------------------------
//
// Applied AFTER the CC mapping (see applySeedAgentLayer in app.js). Sits outside
// Case Center: picks (agentStatus = 'queued') and Track Statuses are operator
// intent, not CC fields. Keep this light — three picked cases, two Track
// Statuses (Weekend Case + Sanity Check) — so the Route Board demos
// MOVING + WATCH-ring-pulse + SANITY-collapsible without being overwhelming.

window.SEED_AGENT_LAYER = {
  // Weekend Case: drives a MOVING lane (User → HQ, scheduled handoff Sun 17:30).
  'C-2402': { agentStatus: 'queued', trackStatus: 'weekend_case' },
  // Sanity Check: two picks so the collapsible group has more than one row.
  'C-2405': { agentStatus: 'queued', trackStatus: 'sanity_check' },
  'C-2406': { agentStatus: 'queued', trackStatus: 'sanity_check' },
};
