// Shift & operator roster for the Case Tracker.
//
// EDIT THIS FILE to change who is on shift — it is kept separate from data.js so the
// roster can be updated without touching cases, owners, weeks or the demo clock.
// The in-app Shift editor (Shifts page) generates exactly the three blocks below; paste
// its output here to make changes permanent.
//
//   window.OPERATORS          — the people; each has a unique id, a name, and a shift.
//   window.SHIFTS             — coverage windows; operatorIds is the roster for that shift.
//   window.CURRENT_OPERATOR_ID — who the app opens as ("you").

window.OPERATORS = [
  { id: 'op-da', name: 'Mia (DA)', shift: 'Day' },
  { id: 'op-na', name: 'Ren (NA)', shift: 'Night' },
  { id: 'op-db', name: 'Kai (DB)', shift: 'Day' },
  { id: 'op-nb', name: 'Yui (NB)', shift: 'Night' },
];

window.SHIFTS = [
  { name: 'Day',   hoursUtc: '08:00 – 20:00 UTC', operatorIds: ['op-da', 'op-db'] },
  { name: 'Night', hoursUtc: '20:00 – 08:00 UTC', operatorIds: ['op-na', 'op-nb'] },
];

window.CURRENT_OPERATOR_ID = 'op-da';

// This week's rota (window.ROTA) and the next three weeks (window.ROTA_BY_WEEK)
// — one cell per (day, shift) combination, each holding any number of operators
// (or none). Days follow the Sunday-first week convention used by window.WEEKS;
// the shift names match window.SHIFTS (Day, Night).
//
// Edit via the Shifts page (pick which week with the tabs, drag operators onto a
// cell, drag again to move or remove, then "Save rota"); paste the generated
// block back here to persist between sessions or for everyone.
//
// `window.ROTA` is the rota for the *current* week (W24-2026). The rotas for the
// next three weeks live under window.ROTA_BY_WEEK keyed by week id. The app
// keeps the two in sync — editing W24 in the UI also mutates window.ROTA.
window.ROTA = [
  { day: 'Sun', shifts: { Day: [],         Night: []         } },
  { day: 'Mon', shifts: { Day: ['op-da'],  Night: ['op-na']  } },
  { day: 'Tue', shifts: { Day: ['op-db'],  Night: ['op-nb']  } },
  { day: 'Wed', shifts: { Day: ['op-da'],  Night: ['op-na']  } },
  { day: 'Thu', shifts: { Day: ['op-db'],  Night: ['op-nb']  } },
  { day: 'Fri', shifts: { Day: ['op-da'],  Night: ['op-na']  } },
  { day: 'Sat', shifts: { Day: [],         Night: []         } },
];

// Future-week rotas. Default to the current week's pattern; the team can edit
// each one in the Shifts page when they want to.
window.ROTA_BY_WEEK = {
  'W24-2026': window.ROTA,
  'W25-2026': [
    { day: 'Sun', shifts: { Day: [],         Night: []         } },
    { day: 'Mon', shifts: { Day: ['op-da'],  Night: ['op-na']  } },
    { day: 'Tue', shifts: { Day: ['op-db'],  Night: ['op-nb']  } },
    { day: 'Wed', shifts: { Day: ['op-da'],  Night: ['op-na']  } },
    { day: 'Thu', shifts: { Day: ['op-db'],  Night: ['op-nb']  } },
    { day: 'Fri', shifts: { Day: ['op-da'],  Night: ['op-na']  } },
    { day: 'Sat', shifts: { Day: [],         Night: []         } },
  ],
  'W26-2026': [
    { day: 'Sun', shifts: { Day: [],         Night: []         } },
    { day: 'Mon', shifts: { Day: ['op-da'],  Night: ['op-na']  } },
    { day: 'Tue', shifts: { Day: ['op-db'],  Night: ['op-nb']  } },
    { day: 'Wed', shifts: { Day: ['op-da'],  Night: ['op-na']  } },
    { day: 'Thu', shifts: { Day: ['op-db'],  Night: ['op-nb']  } },
    { day: 'Fri', shifts: { Day: ['op-da'],  Night: ['op-na']  } },
    { day: 'Sat', shifts: { Day: [],         Night: []         } },
  ],
  'W27-2026': [
    { day: 'Sun', shifts: { Day: [],         Night: []         } },
    { day: 'Mon', shifts: { Day: ['op-da'],  Night: ['op-na']  } },
    { day: 'Tue', shifts: { Day: ['op-db'],  Night: ['op-nb']  } },
    { day: 'Wed', shifts: { Day: ['op-da'],  Night: ['op-na']  } },
    { day: 'Thu', shifts: { Day: ['op-db'],  Night: ['op-nb']  } },
    { day: 'Fri', shifts: { Day: ['op-da'],  Night: ['op-na']  } },
    { day: 'Sat', shifts: { Day: [],         Night: []         } },
  ],
};
