# Self-hosting the Case Tracker on an Ubuntu server

A step-by-step runbook to stand up the **full stack** on your own Ubuntu box:
the FastAPI API (`backend/`) serving the vanilla-JS SPA (`prototype/`) **same-origin**,
backed by **PostgreSQL**, with the shared-token login.

> Env-var meanings are documented once in **[`SETUP.md`](SETUP.md)** — this runbook tells you
> *which* to set on a server and *how* to wire the machine; it links there instead of repeating
> the table. Architecture overview: **[`../backend/README.md`](../backend/README.md)**.

What you get at the end: `https://your-host/` shows the board behind a login; `https://your-host/api/*`
is the auth-gated API; data lives in Postgres and is shared across operators/devices.

---

## 0. Requirements & gotchas (read first)

- **Ubuntu 22.04 or 24.04.** Needs **Python ≥ 3.10** (the backend uses `str | None` syntax).
  22.04 ships 3.10, 24.04 ships 3.12 — both fine.
- **Node ≥ 18.** The DB seeder (`backend/seed_board_json.cjs`) and the bundler use
  `structuredClone`, which needs Node 17+. **Ubuntu's default `nodejs` apt package is too old** —
  install Node 20 from NodeSource (Step 1).
- **`DATABASE_URL` must use the `postgresql+psycopg://` scheme** (the app also auto-normalises a
  plain `postgres://`/`postgresql://`, but prefer the explicit form).
- Run the API **from the repo root** as `backend.api:app` (it uses package-relative imports and
  serves `prototype/` from the repo root). Don't `cd backend` to launch it.

Throughout, replace placeholders like `<STRONG_DB_PASSWORD>` and `<API_TOKEN>`.

---

## 1. Install system packages

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip postgresql git curl

# Node 20 (NodeSource) — the apt 'nodejs' is too old for the tooling:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

python3 --version   # expect >= 3.10
node --version      # expect >= 18
```

## 2. Get the code

```bash
cd /opt
sudo git clone https://github.com/hltsai9/threenine.git
sudo chown -R "$USER": threenine
cd threenine
git checkout worktree-implement-review-fixes      # or 'main' once the branch is merged
```

## 3. Create the PostgreSQL database

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE casetracker;
CREATE USER casetracker WITH PASSWORD '<STRONG_DB_PASSWORD>';
GRANT ALL PRIVILEGES ON DATABASE casetracker TO casetracker;
SQL

# Postgres 15+ also needs schema-level grants:
sudo -u postgres psql -d casetracker -c "GRANT ALL ON SCHEMA public TO casetracker;"
```

Your connection string (used as `DATABASE_URL`):
```
postgresql+psycopg://casetracker:<STRONG_DB_PASSWORD>@localhost:5432/casetracker
```

## 4. Python environment

```bash
cd /opt/threenine
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt     # includes psycopg (PostgreSQL driver)
```

## 5. Configure the environment

Create `/opt/threenine/.env.casetracker` (root-readable only):

```bash
cat > /opt/threenine/.env.casetracker <<EOF
DATABASE_URL=postgresql+psycopg://casetracker:<STRONG_DB_PASSWORD>@localhost:5432/casetracker
API_AUTH_TOKEN=$(openssl rand -hex 32)
SERVE_STATIC=1
AUTO_CREATE=1
EOF
chmod 600 /opt/threenine/.env.casetracker
cat /opt/threenine/.env.casetracker      # note the generated API_AUTH_TOKEN — operators log in with it
```

See **[`SETUP.md`](SETUP.md)** for what each variable does. `AUTO_CREATE=1` creates the schema on
first boot (simplest); switch to `0` + Alembic for stricter production (Step 6, option B).

## 6. Create the schema

**Option A — simplest (AUTO_CREATE).** Nothing to do: with `AUTO_CREATE=1` the tables are
created from the model on first boot (Step 8).

**Option B — migrations (recommended for production).** Set `AUTO_CREATE=0` in the env file, then:
```bash
cd /opt/threenine/backend
DATABASE_URL='postgresql+psycopg://casetracker:<STRONG_DB_PASSWORD>@localhost:5432/casetracker' \
  ../.venv/bin/alembic upgrade head
cd /opt/threenine
```

## 7. Configure the front end

Edit `prototype/config.js`:
- `window.API_BASE = ''` — same-origin (the API serves the SPA), no CORS.
- `window.API_MODE = ''` — leave empty; the SPA **auto-detects** the backend by probing
  `/healthz` and switches to server mode (shared login + DB persistence). Set `'server'` to force it.

Edit `prototype/owners.js` — set the department lists to your **real Case Center** department
names so the Route Board places dots correctly:
```js
window.CC_CORE_DEPARTMENTS = ['Site IT'];                  // → Core Team / 1st Line
window.CC_HQ_DEPARTMENTS   = ['HQ Identity', 'HQ Mobile']; // → HQ (can be several)
```
If you edited any `prototype/` source and want the single-file build refreshed:
`node prototype/bundle.mjs` (optional — `index.html` loads the modular files directly).

## 8. First run (foreground smoke test)

```bash
cd /opt/threenine
set -a; source .env.casetracker; set +a
.venv/bin/uvicorn backend.api:app --host 0.0.0.0 --port 8000
```
In another shell: `curl -s localhost:8000/healthz` → `{"ok":true}`. Open
`http://<server-ip>:8000/` in a browser — you should get the **login screen**. Stop with Ctrl-C.

## 9. Seed the database (demo data)

With the server running (Step 8) or via the service (Step 11):
```bash
cd /opt/threenine
set -a; source .env.casetracker; set +a
node backend/seed_board_json.cjs | \
  curl -sS -XPOST -H "Authorization: Bearer $API_AUTH_TOKEN" \
       -H 'content-type: application/json' --data-binary @- \
       http://localhost:8000/api/save
# expect: {"ok":true,"added":38,...}
```
(For real data instead of the demo seed, see Step 13.)

## 10. Verify end-to-end

```bash
curl -s localhost:8000/healthz                                            # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' localhost:8000/api/cases         # 401 (gated — good)
curl -s -H "Authorization: Bearer $API_AUTH_TOKEN" localhost:8000/api/cases | head -c 120
                                                                          # {"cases":[...],"operatorLayer":"server"}
```
Browser: open the site, **sign in with the `API_AUTH_TOKEN`**, and confirm the Hand-off Route
Board shows dots across **User / 1st Line / Core Team / HQ** with settled rings and intent arrows.
Pick a case in one browser, refresh a second browser (sign in) → the pick persists (DB-backed).

## 11. Run as a service (systemd)

```bash
sudo tee /etc/systemd/system/casetracker.service >/dev/null <<'UNIT'
[Unit]
Description=Case Tracker API + SPA
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/threenine
EnvironmentFile=/opt/threenine/.env.casetracker
ExecStart=/opt/threenine/.venv/bin/uvicorn backend.api:app --host 127.0.0.1 --port 8000
Restart=on-failure
User=www-data

[Install]
WantedBy=multi-user.target
UNIT

sudo chown -R www-data: /opt/threenine
sudo systemctl daemon-reload
sudo systemctl enable --now casetracker
sudo systemctl status casetracker --no-pager
```
(Bind to `127.0.0.1` here and put nginx in front — Step 12.)

## 12. Reverse proxy + HTTPS (nginx + certbot)

HTTPS is strongly recommended (the login token travels in a header; browsers also treat
`sessionStorage`/secure contexts better).

```bash
sudo apt install -y nginx
sudo tee /etc/nginx/sites-available/casetracker >/dev/null <<'NGINX'
server {
    listen 80;
    server_name your-host.example.com;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/casetracker /etc/nginx/sites-enabled/casetracker
sudo nginx -t && sudo systemctl reload nginx

# TLS:
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-host.example.com
```
Open `https://your-host.example.com/`, sign in, done.

## 13. (Optional) Real Case Center ingestion instead of the demo seed

The Step 9 seeder loads demo data. For live cases, wire `local/casecenter.py` `fetch_raw()` +
credentials per **[`SETUP.md`](SETUP.md)**, then run the ingest pipeline on a schedule:
```bash
# one-off:
cd /opt/threenine && set -a; source .env.casetracker; set +a
.venv/bin/python -m backend.ingest
```
Schedule it with a systemd timer or cron (e.g. every few minutes). Credentials live **only** on
the ingest side — the read API stays credential-free.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `relation "cases" does not exist` on save | Schema not created → `AUTO_CREATE=1` (Step 5) or run Alembic (Step 6B). |
| Browser board shows the **login screen** but rejects the token | The entered token must equal `API_AUTH_TOKEN`. Re-check the env file; restart the service after changing it. |
| Board loads but **every case sits at "1st Line"** | `owners.js` `CC_CORE_DEPARTMENTS`/`CC_HQ_DEPARTMENTS` don't match your cases' `assigneeDept`. Set them to your real CC department names (Step 7). |
| `TypeError: unsupported operand` / `str | None` on startup | Python < 3.10. Use 3.10+ (Step 0). |
| SQLAlchemy "can't load plugin postgresql.psycopg2" | `DATABASE_URL` must be `postgresql+psycopg://…` (psycopg v3), which Step 3 uses. |
| `structuredClone is not defined` running the seeder | Node < 17. Install Node 20 (Step 1). |
| Board ignores the API and shows seed data | `config.js` `API_MODE` is forced to `'demo'`/`'off'`, or `/healthz` isn't reachable from the browser origin. Leave `API_MODE=''` and ensure the API is served same-origin. |
| `npm`/`node` not found in the systemd context | Run the seeder (Step 9) as your shell user, not from the `www-data` service. |

## Updating to a new version

```bash
cd /opt/threenine && git pull
.venv/bin/pip install -r backend/requirements.txt          # if deps changed
cd backend && ../.venv/bin/alembic upgrade head; cd ..      # if using migrations
sudo systemctl restart casetracker
```
