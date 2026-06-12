// Owner directory for the Case Tracker — Core Team desks and HQ Product Teams.
//
// EDIT THIS FILE to change who cases get routed to. Kept separate from data.js so it can be
// updated (including via the in-app Owners editor) without touching cases or the clock.
// The in-app Owners editor (Owners page) generates exactly the block below; paste its
// output here to make changes permanent.
//
//   fit: Core Team desks  — { id, name, region, tz, office, channel, members[] }
//   hq:  HQ Product Teams — { id, name, area,   tz, office, channel }
// Case routing references these by id (case.fitId / case.hqId). Each Core Team carries
// a small `members` roster (id, name, role) so cards can show who on the team owns it.

window.OWNERS = {
  fit: [
    {
      id: 'fit-apac', name: 'FIT — APAC desk', region: 'APAC',
      tz: 'America/Phoenix', office: '08:00–17:00', channel: 'Slack #fit-apac',
      members: [
        { id: 'fit-apac-lead', name: 'Hana Park',   role: 'Lead' },
        { id: 'fit-apac-eng',  name: 'Kenji Sato',  role: 'Engineer' },
        { id: 'fit-apac-eng2', name: 'Mei Lin',     role: 'Engineer' },
      ],
    },
    {
      id: 'fit-emea', name: 'FIT — EMEA desk', region: 'EMEA',
      tz: 'America/Phoenix', office: '08:00–17:00', channel: 'Slack #fit-emea',
      members: [
        { id: 'fit-emea-lead', name: 'Lukas Berg',  role: 'Lead' },
        { id: 'fit-emea-eng',  name: 'Sofia Ricci', role: 'Engineer' },
        { id: 'fit-emea-eng2', name: 'Omar Haddad', role: 'Engineer' },
      ],
    },
    {
      id: 'fit-amer', name: 'FIT — AMER desk', region: 'AMER',
      tz: 'America/Phoenix', office: '08:00–17:00', channel: 'Slack #fit-amer',
      members: [
        { id: 'fit-amer-lead', name: 'Jordan Reed', role: 'Lead' },
        { id: 'fit-amer-eng',  name: 'Ava Nguyen',  role: 'Engineer' },
        { id: 'fit-amer-eng2', name: 'Diego Alvarez', role: 'Engineer' },
      ],
    },
  ],
  hq: [
    { id: 'hq-identity', name: 'HQ Identity Team',  area: 'Identity / SSO', tz: 'Asia/Taipei', office: '09:00–18:00', channel: 'JIRA queue' },
    { id: 'hq-data',     name: 'HQ Data Platform',  area: 'Data Platform',  tz: 'Asia/Taipei', office: '09:00–18:00', channel: 'JIRA queue' },
    { id: 'hq-mobile',   name: 'HQ Mobile App',     area: 'Mobile',         tz: 'Asia/Taipei', office: '09:00–18:00', channel: 'JIRA queue' },
  ],
};
