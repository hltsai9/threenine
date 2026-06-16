# Self-hosting the Case Tracker on an Ubuntu server

A step-by-step runbook to stand up the **full stack** on your own Ubuntu box:
the FastAPI API (`backend/`) serving the vanilla-JS SPA (`prototype/`) **same-origin**,
backed by **MySQL**, with the shared-token login.

> Env-var meanings are documented once in **[`SETUP.md`](SETUP.md)** — this runbook tells you
> *which* to set on a server and *how* to wire the machine; it links there instead of repeating
> the table. Architecture overview: **[`../backend/README.md`](../backend/README.md)**.

What you get at the end: `https://your-host/` shows the board behind a login; `https://your-host/api/*`
is the auth-gated API; data lives in MySQL and is shared across operators/devices.

> **Using PostgreSQL or SQLite instead?** The only differences are Steps 1, 3 and the
> `DATABASE_URL` you put in the env file — the app picks the backend from that URL alone
> (`backend/db.py`). For Postgres use `postgresql+psycopg://…` and `sudo apt install postgresql`;
> for a quick demo, omit `DATABASE_URL` entirely and it falls back to a SQLite file in the repo.

---

## 0. Requirements & gotchas (read first)

- **Ubuntu 22.04 or 24.04.** Needs **Python ≥ 3.10** (the backend uses `str | None` syntax).
  22.04 ships 3.10, 24.04 ships 3.12 — both fine.
- **Node ≥ 18.** The DB seeder (`backend/seed_board_json.cjs`) and the bundler use
  `structuredClone`, which needs Node 17+. **Ubuntu's default `nodejs` apt package is too old** —
  install Node 20 from NodeSource (Step 1).
- **`DATABASE_URL` must use the `mysql+pymysql://` scheme** and end with `?charset=utf8mb4`.
  The driver is **PyMySQL** (pure-Python, no build step), already in `backend/requirements.txt`.
- **Create the database as `utf8mb4`.** Cases are stored as a JSON `payload` that can hold
  non-ASCII subjects and emoji; `utf8mb4` avoids encoding errors. MySQL **8.0+** (native `JSON`
  column type) is recommended; MariaDB 10.5+ also works (it stores JSON as `LONGTEXT`).
- If your DB password contains URL-special characters (`@ : / ? # %`), either pick a password
  without them or percent-encode them in the `DATABASE_URL` (e.g. `@` → `%40`).
- Run the API **from the repo root** as `backend.api:app` (it uses package-relative imports and
  serves `prototype/` from the repo root). Don't `cd backend` to launch it.

Throughout, replace placeholders like `<STRONG_DB_PASSWORD>` and `<API_TOKEN>`.

---

## 1. Install system packages

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip mysql-server git curl

# Node 20 (NodeSource) — the apt 'nodejs' is too old for the tooling:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

python3 --version   # expect >= 3.10
node --version      # expect >= 18
mysql --version     # expect 8.0+ (or MariaDB 10.5+)
```

Optional but recommended on a fresh install — lock down the MySQL root account and remove the
anonymous/test defaults:

```bash
sudo mysql_secure_installation
```

## 2. Get the code

```bash
cd /opt
sudo git clone https://github.com/hltsai9/threenine.git
sudo chown -R "$USER": threenine
cd threenine
git checkout worktree-implement-review-fixes      # or 'main' once the branch is merged
```

## 3. Create the MySQL database

On Ubuntu the `root` MySQL user authenticates via the unix socket, so `sudo mysql` gets you in
without a password:

```bash
sudo mysql <<'SQL'
CREATE DATABASE casetracker CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'casetracker'@'localhost' IDENTIFIED BY '<STRONG_DB_PASSWORD>';
GRANT ALL PRIVILEGES ON casetracker.* TO 'casetracker'@'localhost';
FLUSH PRIVILEGES;
SQL
```

Verify the app user can log in and see the database:
```bash
mysql -u casetracker -p -e 'SHOW DATABASES;'      # enter <STRONG_DB_PASSWORD>; expect 'casetracker' listed
```

Your connection string (used as `DATABASE_URL`):
```
mysql+pymysql://casetracker:<STRONG_DB_PASSWORD>@localhost:3306/casetracker?charset=utf8mb4
```

## 4. Python environment

```bash
cd /opt/threenine
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt     # includes PyMySQL (MySQL driver)
```

## 5. Configure the environment

Create `/opt/threenine/.env.casetracker` (root-readable only):

```bash
cat > /opt/threenine/.env.casetracker <<EOF
DATABASE_URL=mysql+pymysql://casetracker:<STRONG_DB_PASSWORD>@localhost:3306/casetracker?charset=utf8mb4
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
DATABASE_URL='mysql+pymysql://casetracker:<STRONG_DB_PASSWORD>@localhost:3306/casetracker?charset=utf8mb4' \
  ../.venv/bin/alembic upgrade head
cd /opt/threenine
```

## 7. Configure the front end

Edit `prototype/config.js`:
- `window.API_BASE = ''` — same-origin (the API serves the SPA), no CORS.
- `window.API_MODE = ''` — leave empty; the SPA **auto-detects** the backend by probing
  `/healthz` and switches to server mode (shared login + DB persistence). Set `'server'` to force it.
- `window.TOUR_AUTOSTART = false` — the onboarding tour stays off (operators can still launch it
  from the sidebar "Take the tour" link). It's already `false` by default.

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
After=network.target mysql.service

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

## 13. Periodic ingestion from Case Center (replaces the demo seed)

The Step 9 seeder loads demo data once. For **live cases flowing into the DB on a schedule**, use
the ingest script — `backend/ingest.py`. It fetches from Case Center and upserts **only
CC-owned fields**, so operator work (picks / Track Status / handover) is preserved
(`merge.upsert_cc`). It's a **one-shot** run; a systemd timer makes it periodic.

**13a. Wire your Case Center request + credentials (one-time).**
`local/casecenter.py` `fetch_raw()` ships as a **stub** — paste your real Case Center request
there (`return x_json["data"]`) per **[`SETUP.md`](SETUP.md)**. Add the credentials to the env
file (they stay on the ingest side only):
```bash
cat >> /opt/threenine/.env.casetracker <<'EOF'
CASE_CENTER_API_KEY=...
CASE_CENTER_COOKIE=...
CASE_CENTER_BASE_URL=https://case-center.your-org.example
EOF
```

**13b. One-off test:**
```bash
cd /opt/threenine && set -a; source .env.casetracker; set +a
.venv/bin/python -m backend.ingest --hours 1 --no-create     # fetch cases updated in the last hour
```
Re-running is safe — upsert dedups by case id, so overlapping windows can't duplicate cases.

**13c. Run it every 5 minutes with a systemd timer:**
```bash
sudo tee /etc/systemd/system/casetracker-ingest.service >/dev/null <<'UNIT'
[Unit]
Description=Case Tracker — ingest from Case Center
After=network-online.target mysql.service

[Service]
Type=oneshot
WorkingDirectory=/opt/threenine
EnvironmentFile=/opt/threenine/.env.casetracker
# --hours should be >= the timer interval (+ margin) so nothing is missed; --no-create skips
# table creation (the API already created the schema).
ExecStart=/opt/threenine/.venv/bin/python -m backend.ingest --hours 1 --no-create
User=www-data
UNIT

sudo tee /etc/systemd/system/casetracker-ingest.timer >/dev/null <<'UNIT'
[Unit]
Description=Run Case Tracker ingest periodically

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now casetracker-ingest.timer
systemctl list-timers casetracker-ingest.timer --no-pager      # see next run
journalctl -u casetracker-ingest.service -n 50 --no-pager      # see last run's output
```

**Cron alternative** (if you'd rather not use a timer):
```bash
# crontab -e  (as the service user)
*/5 * * * * cd /opt/threenine && set -a && . ./.env.casetracker && set +a && \
  .venv/bin/python -m backend.ingest --hours 1 --no-create >> /var/log/casetracker-ingest.log 2>&1
```

Notes:
- Tune `--hours` to your cadence (here a 1-hour window polled every 5 min — lots of safe overlap).
  Use `--hours A --to-hours B` for a band, or `--id C-1234` for a single case.
- The timer runs `ingest_live`, which holds the Case Center credentials; the API service
  (Step 11) never sees them.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Table 'casetracker.cases' doesn't exist` on save | Schema not created → `AUTO_CREATE=1` (Step 5) or run Alembic (Step 6B). |
| `ModuleNotFoundError: No module named 'pymysql'` / "can't load plugin mysql.pymysql" | The driver isn't installed → `pip install -r backend/requirements.txt` in the venv (Step 4), and `DATABASE_URL` must start with `mysql+pymysql://` (Step 3). |
| `Access denied for user 'casetracker'@'localhost'` | Wrong password or grants → re-run the `CREATE USER` / `GRANT` in Step 3; check the password in `DATABASE_URL` (URL-encode special chars). |
| Garbled non-ASCII subjects / `Incorrect string value` | Database isn't `utf8mb4` → recreate it with `CHARACTER SET utf8mb4` (Step 3) and add `?charset=utf8mb4` to `DATABASE_URL`. |
| Browser board shows the **login screen** but rejects the token | The entered token must equal `API_AUTH_TOKEN`. Re-check the env file; restart the service after changing it. |
| Board loads but **every case sits at "1st Line"** | `owners.js` `CC_CORE_DEPARTMENTS`/`CC_HQ_DEPARTMENTS` don't match your cases' `assigneeDept`. Set them to your real CC department names (Step 7). To list the real values: `mysql -u casetracker -p casetracker -e "SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(payload,'$.assigneeDept')) FROM cases;"` |
| `TypeError: unsupported operand` / `str | None` on startup | Python < 3.10. Use 3.10+ (Step 0). |
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
