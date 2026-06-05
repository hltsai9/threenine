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
