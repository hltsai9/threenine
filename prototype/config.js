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
//   ''        (default) -> single-user / demo. Operator layer is cached in this browser's
//                          localStorage; the seed (or serve.py's Case Center pull) is the
//                          case source. No cross-browser sharing.
//   'server'            -> the API (backend/api.py, DB-backed) is the source of truth. The
//                          SPA loads ALL cases — including the operator layer — from it on
//                          boot, does NOT overlay localStorage, and round-trips every edit
//                          via POST /api/save. This is the multi-operator deployment mode.
//
// Set to 'server' only when serving against backend/api.py (whose response advertises
// operatorLayer:"server"); leave '' for file:// demos and the serve.py single-user proxy.
window.API_MODE = '';
