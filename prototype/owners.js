// Owner directory for the Case Tracker — Local FIT desks and HQ Product Teams.
//
// EDIT THIS FILE to change who cases get routed to. Kept separate from data.js so it can be
// updated (including via the in-app Owners editor) without touching cases or the clock.
// The in-app Owners editor (Owners page) generates exactly the block below; paste its
// output here to make changes permanent.
//
//   fit: Local FIT desks  — { id, name, region, tz, office, channel }
//   hq:  HQ Product Teams — { id, name, area,   tz, office, channel }
// Case routing references these by id (case.fitId / case.hqId).

window.OWNERS = {
  fit: [
    { id: 'fit-apac', name: 'FIT — APAC desk',  region: 'APAC', tz: 'America/Phoenix', office: '08:00–17:00', channel: 'Slack #fit-apac' },
    { id: 'fit-emea', name: 'FIT — EMEA desk',  region: 'EMEA', tz: 'America/Phoenix', office: '08:00–17:00', channel: 'Slack #fit-emea' },
    { id: 'fit-amer', name: 'FIT — AMER desk',  region: 'AMER', tz: 'America/Phoenix', office: '08:00–17:00', channel: 'Slack #fit-amer' },
  ],
  hq: [
    { id: 'hq-identity', name: 'HQ Identity Team',  area: 'Identity / SSO', tz: 'Asia/Taipei', office: '09:00–18:00', channel: 'JIRA queue' },
    { id: 'hq-data',     name: 'HQ Data Platform',  area: 'Data Platform',  tz: 'Asia/Taipei', office: '09:00–18:00', channel: 'JIRA queue' },
    { id: 'hq-mobile',   name: 'HQ Mobile App',     area: 'Mobile',         tz: 'Asia/Taipei', office: '09:00–18:00', channel: 'JIRA queue' },
  ],
};
