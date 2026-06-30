# Kubernetes deployment

Same-origin stack: the **API Deployment** serves both `/api/*` and the static SPA, the
**ingest CronJob** refreshes cases from Case Center, and the **Ingress** terminates TLS. Only the
ingest workload holds Case Center credentials.

See [`../../docs/SELF-HOST-UBUNTU.md`](../../docs/SELF-HOST-UBUNTU.md) for env-var meaning and
[`../../backend/README.md`](../../backend/README.md) for the architecture.

## Build & push the images

```bash
docker build -f deploy/Dockerfile.api    -t YOUR_REGISTRY/case-tracker-api:1.0.0 .
docker build -f deploy/Dockerfile.ingest -t YOUR_REGISTRY/case-tracker-ingest:1.0.0 .
docker push YOUR_REGISTRY/case-tracker-api:1.0.0
docker push YOUR_REGISTRY/case-tracker-ingest:1.0.0
```

> The manifests reference `case-tracker-api:latest` / `case-tracker-ingest:latest`. **Pin to an
> immutable tag or digest** (e.g. `:1.0.0`) in production — `:latest` makes rollbacks and
> reproducibility hard. Update the `image:` fields to your registry path.

## Apply order

1. **Secrets** — copy `secrets.example.yaml`, fill in real values (do NOT commit), and apply.
   `API_AUTH_TOKEN` is **required** or the API runs open. Generate it: `openssl rand -hex 32`.
   ```bash
   kubectl apply -f secrets.example.yaml   # after editing — or use sealed-secrets/external-secrets
   ```
2. **API + Service + PDB** — the Deployment's initContainer runs `alembic upgrade head` before the
   app starts (`AUTO_CREATE=0`).
   ```bash
   kubectl apply -f api-deployment.yaml
   kubectl rollout status deploy/case-tracker-api
   ```
3. **Seed the roster/owners** (once) — optional; or use the in-app Save buttons.
   ```bash
   kubectl apply -f seed-config-job.yaml
   kubectl wait --for=condition=complete job/case-tracker-seed-config --timeout=120s
   ```
4. **Ingest CronJob** — set the schedule and apply.
   ```bash
   kubectl apply -f ingest-cronjob.yaml
   ```
5. **Ingress** — set `ingressClassName`, host, and TLS issuer, then apply.
   ```bash
   kubectl apply -f ingress.yaml
   ```

## Verify

```bash
kubectl get pods -l app=case-tracker-api
kubectl exec deploy/case-tracker-api -- python -c "import urllib.request as u; print(u.urlopen('http://localhost:8000/healthz').read())"
# /api/cases should be 401 without the token (gated — good); 200 with it.
```

## Notes

- **Probes** hit the unauthenticated `/healthz` on purpose — probing `/api/cases` would 401 once
  `API_AUTH_TOKEN` is set and pods would never become Ready.
- **Migrations with replicas > 1**: each pod's initContainer runs `alembic upgrade head`; on
  PostgreSQL the concurrent runs are safe (transactional DDL — one wins, the rest no-op). For
  stricter control, run migrations as a one-shot Job / Helm pre-upgrade hook and drop the
  initContainer.
- All workloads run **non-root** with a read-only root filesystem and dropped capabilities; only
  `/tmp` is writable (emptyDir).
