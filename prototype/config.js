// Front-end configuration. This is the ONE place that tells the static SPA where
// the back-end API lives.
//
//   ''  (empty)         -> same origin. Use this when the API and the static files
//                          are served from the same host (the K8s Ingress setup,
//                          or backend/api.py serving prototype/ itself). No CORS.
//   'https://host:port' -> a separate API host. The backend must allow this page's
//                          origin via ALLOWED_ORIGINS, and the schemes must match
//                          (an HTTPS page cannot call an HTTP API — mixed content).
//
// Left empty by default so standalone.html / file:// demos stay in pure seed mode.
window.API_BASE = '';

// How the operator layer (picks / Track Status / handover / reminder) is persisted:
//
//   ''        (default) -> AUTO-DETECT. On boot the SPA probes GET /healthz; if a DB-backed
//                          backend (backend/api.py) answers, it switches to server mode by
//                          itself. The file:// demo, GitHub Pages and the serve.py proxy have
//                          no /healthz, so they stay single-user/demo. Usually leave this as ''.
//   'server'            -> force server mode (the DB API is the source of truth): load ALL
//                          cases + the shared operator layer from it, no localStorage overlay,
//                          round-trip every edit via POST /api/save. Multi-operator mode.
//   'demo' / 'off'      -> force single-user/demo; never call the API even if one is present.
//
// With auto-detect you normally don't need to touch this — a Render/backend deployment just
// works at '' because it serves /healthz.
window.API_MODE = '';

// Guided tour: whether it auto-starts on a visitor's first load.
//   false (default) -> never auto-start; the sidebar "Take the tour" link still works.
//   true            -> auto-start once per browser (the demo/Pages onboarding experience).
// Disabled by default — internal operators don't need the onboarding tour on every fresh browser.
window.TOUR_AUTOSTART = false;
