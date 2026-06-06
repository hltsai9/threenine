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
