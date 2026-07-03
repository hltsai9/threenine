# Kubernetes deployment

Same-origin stack: the **API Deployment** serves both `/api/*` and the static SPA, the
**ingest CronJob** refreshes cases from Case Center, and the **Ingress** terminates TLS. Only the
ingest workload holds Case Center credentials. Everything runs in the dedicated
**`case-tracker` namespace** (`namespace.yaml`, PSA `restricted`) behind a default-deny-ingress
**NetworkPolicy** (`networkpolicy.yaml`).

See [`../../docs/SELF-HOST-UBUNTU.md`](../../docs/SELF-HOST-UBUNTU.md) for env-var meaning and
[`../../backend/README.md`](../../backend/README.md) for the architecture.

## CI/CD (Azure DevOps)

[`../../azure-pipelines.yml`](../../azure-pipelines.yml) automates the whole path:
tests + Trivy **code scan** (deps, secrets, IaC) on every push/PR → image builds gated by a
Trivy **image scan** → push to ACR → kustomize-pinned deploy to AKS behind an
Environment approval, with SBOMs published per build. One-time setup (service connections,
Environment, variables) is documented at the top of that file.

The `image:` fields in these manifests are `…:set-by-pipeline` **placeholders** — the deploy
stage pins the real registry + immutable tag via `kustomize edit set image`
(see `kustomization.yaml`). Nothing ever deploys as `:latest`.

## Build & push the images (manual fallback)

```bash
docker build -f deploy/Dockerfile.api    -t YOUR_REGISTRY/case-tracker-api:1.0.0 .
docker build -f deploy/Dockerfile.ingest -t YOUR_REGISTRY/case-tracker-ingest:1.0.0 .
docker push YOUR_REGISTRY/case-tracker-api:1.0.0
docker push YOUR_REGISTRY/case-tracker-ingest:1.0.0
```

## Apply order (manual fallback)

The pipeline's deploy stage does 2–3 for you (`kustomize build` → apply). By hand:

1. **Namespace** — everything below lives in `case-tracker`.
   ```bash
   kubectl apply -f namespace.yaml
   ```
2. **Secrets** — copy `secrets.example.yaml`, fill in real values (do NOT commit), and apply.
   `API_AUTH_TOKEN` is **required** or the API runs open. Generate it: `openssl rand -hex 32`.
   ```bash
   kubectl apply -f secrets.example.yaml   # after editing — or use sealed-secrets/external-secrets
   ```
3. **Everything else via kustomize** — pin your image tags, render, apply:
   ```bash
   cd deploy/k8s
   kustomize edit set image \
     case-tracker-api=YOUR_REGISTRY/case-tracker-api:1.0.0 \
     case-tracker-ingest=YOUR_REGISTRY/case-tracker-ingest:1.0.0
   kubectl apply -k .
   kubectl -n case-tracker rollout status deploy/case-tracker-api
   ```
   (Adjust `ingressClassName`, host and TLS issuer in `ingress.yaml`, the schedule in
   `ingest-cronjob.yaml`, and tighten the `allow-api-inbound` policy in `networkpolicy.yaml`
   to your ingress controller's namespace.)
4. **Seed the roster/owners** (once) — optional; or use the in-app Save buttons.
   ```bash
   kubectl apply -f seed-config-job.yaml    # pin the image tag in the file first
   kubectl -n case-tracker wait --for=condition=complete job/case-tracker-seed-config --timeout=120s
   ```

## Verify

```bash
kubectl -n case-tracker get pods -l app=case-tracker-api
kubectl -n case-tracker exec deploy/case-tracker-api -- python -c "import urllib.request as u; print(u.urlopen('http://localhost:8000/healthz').read())"
# /api/cases should be 401 without the token (gated — good); 200 with it.
```

## Notes

- **Probes** hit the unauthenticated `/healthz` on purpose — probing `/api/cases` would 401 once
  `API_AUTH_TOKEN` is set and pods would never become Ready.
- **Migrations with replicas > 1**: each pod's initContainer runs `alembic upgrade head`; on
  PostgreSQL the concurrent runs are safe (transactional DDL — one wins, the rest no-op). For
  stricter control, run migrations as a one-shot Job / Helm pre-upgrade hook and drop the
  initContainer.
- All workloads run **non-root (UID 10001)** with a read-only root filesystem, dropped
  capabilities, `RuntimeDefault` seccomp and **no service-account token** mounted; only `/tmp`
  is writable (emptyDir).
- **Scanner posture**: manifests + Dockerfiles pass `checkov -d deploy` and
  `trivy config deploy` clean; the two intentional deviations (secrets consumed as env vars,
  tag-not-digest pinning) are skip-annotated on each workload with the reason.
