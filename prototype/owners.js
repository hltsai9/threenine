// Owner directory for the Case Tracker — Core Team desks and HQ Product Teams.
//
// EDIT THIS FILE to change who cases get routed to. Kept separate from data.js so it can be
// updated (including via the in-app Owners editor) without touching cases or the clock.
// The in-app Owners editor (Owners page) generates exactly the block below; paste its
// output here to make changes permanent.
//
//   core: Core Team desks  — { id, name, region, tz, office, channel, route_role, members[] }
//   hq:  HQ Product Teams — { id, name, area,   tz, office, channel, route_role }
// Case routing references these by id (case.coreId / case.hqId). Each Core Team carries
// a small `members` roster (id, name, role) so cards can show who on the team owns it.
//
// `route_role` maps each desk / product team to one of the three Route Board stations
// (Core Team / HQ / User). The Route Board uses CC's `assigneeDept` to look up the
// matching row here and resolve the station; if no row matches, the case is treated
// as sitting at *User*. See docs/case-center-overview-plan.md §6.

window.OWNERS = {
  core: [
    {
      id: 'core-apac', name: 'Core Team — APAC desk', region: 'APAC',
      tz: 'America/Phoenix', office: '08:00–17:00', channel: 'Slack #core-apac', route_role: 'Core Team',
      members: [
        { id: 'core-apac-lead', name: 'Hana Park',   role: 'Lead' },
        { id: 'core-apac-eng',  name: 'Kenji Sato',  role: 'Engineer' },
        { id: 'core-apac-eng2', name: 'Mei Lin',     role: 'Engineer' },
      ],
    },
    {
      id: 'core-emea', name: 'Core Team — EMEA desk', region: 'EMEA',
      tz: 'America/Phoenix', office: '08:00–17:00', channel: 'Slack #core-emea', route_role: 'Core Team',
      members: [
        { id: 'core-emea-lead', name: 'Lukas Berg',  role: 'Lead' },
        { id: 'core-emea-eng',  name: 'Sofia Ricci', role: 'Engineer' },
        { id: 'core-emea-eng2', name: 'Omar Haddad', role: 'Engineer' },
      ],
    },
    {
      id: 'core-amer', name: 'Core Team — AMER desk', region: 'AMER',
      tz: 'America/Phoenix', office: '08:00–17:00', channel: 'Slack #core-amer', route_role: 'Core Team',
      members: [
        { id: 'core-amer-lead', name: 'Jordan Reed', role: 'Lead' },
        { id: 'core-amer-eng',  name: 'Ava Nguyen',  role: 'Engineer' },
        { id: 'core-amer-eng2', name: 'Diego Alvarez', role: 'Engineer' },
      ],
    },
  ],
  hq: [
    {
      id: 'hq-identity', name: 'HQ Identity Team', area: 'Identity / SSO',
      tz: 'Asia/Taipei', office: '09:00–18:00', channel: 'JIRA queue', route_role: 'HQ',
      members: [
        { id: 'hq-identity-lead', name: 'Yuki Tanaka',  role: 'Lead' },
        { id: 'hq-identity-eng',  name: 'Chen Wei',     role: 'Engineer' },
        { id: 'hq-identity-eng2', name: 'Sara Khan',    role: 'Engineer' },
      ],
    },
    {
      id: 'hq-data', name: 'HQ Data Platform', area: 'Data Platform',
      tz: 'Asia/Taipei', office: '09:00–18:00', channel: 'JIRA queue', route_role: 'HQ',
      members: [
        { id: 'hq-data-lead', name: 'Min-Joon Kim', role: 'Lead' },
        { id: 'hq-data-eng',  name: 'Aisha Patel',  role: 'Engineer' },
        { id: 'hq-data-eng2', name: 'Rohan Iyer',   role: 'Engineer' },
      ],
    },
    {
      id: 'hq-mobile', name: 'HQ Mobile App', area: 'Mobile',
      tz: 'Asia/Taipei', office: '09:00–18:00', channel: 'JIRA queue', route_role: 'HQ',
      members: [
        { id: 'hq-mobile-lead', name: 'Aiko Saito',   role: 'Lead' },
        { id: 'hq-mobile-eng',  name: 'Marco Bianchi', role: 'Engineer' },
        { id: 'hq-mobile-eng2', name: 'Tara O\'Neil',  role: 'Engineer' },
      ],
    },
  ],
};

// ---- Route Board department → station config --------------------------------
// The dot on the Hand-off Route Board shows where a case CURRENTLY is, derived from the
// Case Center assignee's DEPARTMENT plus the latest process-timeline processType. Fill these
// in with your real Case Center department names at go-live (these demo values match data.js).
//   - A dept in CC_CORE_DEPARTMENTS means Core Team / 1st Line (processType disambiguates).
//   - A dept in CC_HQ_DEPARTMENTS means HQ. There can be several.
// Matching is case-insensitive exact match against a case's assigneeDept.
window.CC_CORE_DEPARTMENTS = ['Site IT'];
window.CC_HQ_DEPARTMENTS = ['HQ Identity', 'HQ Mobile'];

// User (requester) departments sit at the *User* station on the Route Board. Provide them two ways
// — both are checked (case-insensitive), and a dept matching EITHER is treated as a User dept:
//   - CC_USER_DEPARTMENTS          exact dept names, exactly like CC_CORE_DEPARTMENTS / CC_HQ_DEPARTMENTS.
//   - CC_USER_DEPARTMENT_PREFIXES  name prefixes, for when requesting units share a stem
//                                  (e.g. "ABC-Sales", "ABC-Finance", "XYZ-Ops" → prefixes ['ABC', 'XYZ']).
// Use whichever fits — list exact names you know, add prefixes for families of names, or both.
// Leave either as [] to disable that mode. (A single prefix string is also accepted for convenience.)
window.CC_USER_DEPARTMENTS = [];
window.CC_USER_DEPARTMENT_PREFIXES = ['ABC'];
