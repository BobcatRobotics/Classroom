# Cutover runbook: bare-metal → containerized control plane

**Audience:** an automation agent (or operator) with the `gcloud` CLI
authenticated and a default zone configured. This is a **one-time** migration of
the live GCE VM from the old bare-metal control plane (systemd `coderunner.service`
+ host Caddy + host Alloy) to the containerized control plane (decision 031).

**Assumptions (do not proceed unless all hold):**

- `gcloud` is authenticated and the default zone is set (or `$ZONE` is exported).
- The build + publish pipeline has succeeded, so
  `ghcr.io/mathewdunne/coderunner-control` and `coderunner-workspace` exist on
  GHCR at `:latest` and at the release tag.
- The VM is named `coderunner` and currently runs the **old** bare-metal setup.
- The persistent data disk is `coderunner-data`, mounted at
  `/var/lib/coderunner/data` (student DB + projects). It is a separate disk and
  is never touched destructively here.

**What this cutover does:** containerizes only the **control plane**, keeping the
existing host Caddy (valid TLS certs) and host Alloy in place. The base
`docker-compose.yml` publishes the control plane on `127.0.0.1:4000`, exactly
where host Caddy already proxies — so TLS and metrics scraping keep working with
no Caddy/Alloy changes. This is the lowest-risk path for a live system. Bringing
Caddy and Alloy into compose (the full `docker-compose.prod.yml` model) is a
later, separate step — see [Converging to the full model](#5-converging-to-the-full-model).

**Expected impact:** a few seconds of HTTP 502 from Caddy while the systemd unit
stops and the control container starts. Running student workspace containers are
recycled (recreated on first access on the new network); their projects and
editor state are bind-mounted and preserved.

Set these once in your shell (adjust if your zone var differs):

```bash
export VM=coderunner
export ZONE="${ZONE:?export your zone, or omit --zone below if a gcloud default zone is set}"
# Release tag to deploy. Use the latest published release, or pin one:
export TAG="$(gh release view --json tagName -q .tagName 2>/dev/null || echo latest)"
echo "Deploying tag: $TAG"
```

> If you have a gcloud **default zone** configured (`gcloud config get compute/zone`),
> you can drop every `--zone="$ZONE"` below.

---

## 0. Pre-flight + safety snapshot

Confirm context and that the VM is reachable, then snapshot the data disk. **Do
not skip the snapshot** — it is the rollback floor.

```bash
gcloud config list --format='value(core.project, core.account)'
gcloud compute instances describe "$VM" --zone="$ZONE" \
  --format='value(name, status)'                 # expect: coderunner RUNNING

gcloud compute disks list --filter="name~coderunner" \
  --format='table(name, zone.basename(), sizeGb)'  # confirm coderunner-data exists

SNAP="coderunner-cutover-$(date +%Y%m%d-%H%M%S)"
gcloud compute disks snapshot coderunner-data --zone="$ZONE" --snapshot-names="$SNAP"
echo "Snapshot created: $SNAP"
```

Sanity-check that the images are actually published (optional but cheap):

```bash
gcloud compute ssh "$VM" --zone="$ZONE" --tunnel-through-iap --quiet --command="
  docker manifest inspect ghcr.io/mathewdunne/coderunner-control:$TAG >/dev/null && echo control:$TAG OK
  docker manifest inspect ghcr.io/mathewdunne/coderunner-workspace:$TAG >/dev/null && echo workspace:$TAG OK
"
```

**Abort if:** the VM is not `RUNNING`, the snapshot fails, or either manifest
inspect fails.

---

## 1. Stage the cutover script

The multi-step on-VM work is delivered as a script (avoids SSH quoting hell, and
mirrors how the deploy workflow runs). Write it locally, copy it to the VM, then
run it.

Create `cutover.sh` locally:

```bash
cat > /tmp/cutover.sh <<'SCRIPT'
#!/usr/bin/env bash
# One-time bare-metal -> compose cutover (control plane only; host Caddy/Alloy stay).
set -euo pipefail
TAG="${1:-latest}"
REPO="mathewdunne/CodeRunner"
source /etc/coderunner/deploy.env   # provides DOMAIN, DATA_DIR, APP_USER, WORKSPACE_IMAGE

log() { echo "[cutover] $*"; }

# 1. Stop + neutralize the old bare-metal control plane so it frees :4000 and
#    can't be revived by the boot-time metadata startup script.
log "stopping systemd coderunner.service"
sudo systemctl stop coderunner 2>/dev/null || true
sudo systemctl disable coderunner 2>/dev/null || true
sudo systemctl mask coderunner 2>/dev/null || true

# 2. Ensure the docker compose plugin is present.
if ! docker compose version >/dev/null 2>&1; then
  log "installing docker-compose-plugin"
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -y
  sudo apt-get install -y docker-compose-plugin
fi

# 3. Fetch the base compose file at the deployed tag. (Only the base file: host
#    Caddy keeps terminating TLS against the control plane's 127.0.0.1:4000.)
log "fetching docker-compose.yml @ $TAG"
sudo curl -fsSL "https://raw.githubusercontent.com/$REPO/$TAG/docker-compose.yml" \
  -o /opt/coderunner/docker-compose.yml

# 4. Build the compose .env from the existing one: reuse all secrets, add the
#    compose variables, and drop the in-container path overrides that would
#    break the container (the image fixes /data, /app/...).
log "rebuilding /opt/coderunner/.env"
sudo cp -n /opt/coderunner/.env /opt/coderunner/.env.pre-cutover.bak
sudo bash -c "grep -vE '^(FRC_DATA_DIR|FRC_DB_PATH|CODE_IMAGE|PORT)=' \
  /opt/coderunner/.env.pre-cutover.bak > /opt/coderunner/.env"
sudo bash -c "cat >> /opt/coderunner/.env <<EOF
CODERUNNER_TAG=${TAG}
CODERUNNER_HOST_DATA_DIR=${DATA_DIR}
COMPOSE_FILE=docker-compose.yml
EOF"
sudo chown "$APP_USER:$APP_USER" /opt/coderunner/.env
sudo chmod 600 /opt/coderunner/.env

# 5. Pull and start the stack.
cd /opt/coderunner
log "docker compose pull"
sudo docker compose pull
log "docker compose up -d"
sudo docker compose up -d --remove-orphans

# 6. Wait for health before mutating state.
log "waiting for healthz"
ok=
for _ in $(seq 1 90); do
  if curl -sf http://localhost:4000/healthz >/dev/null; then ok=1; break; fi
  sleep 1
done
if [ -z "$ok" ]; then
  log "healthz did NOT come up — dumping logs and aborting"
  sudo docker compose logs --tail 100 control
  exit 1
fi
log "healthz OK"

# 7. Recycle the old port-mode student containers so the next access recreates
#    them on the coderunner network. Projects/homes are bind-mounted (preserved).
log "recycling workspace containers"
sudo docker compose exec -T control coderunner rebuild-workspaces

log "cutover complete"
SCRIPT
echo "wrote /tmp/cutover.sh"
```

Copy it to the VM:

```bash
gcloud compute scp /tmp/cutover.sh "$VM":/tmp/cutover.sh \
  --zone="$ZONE" --tunnel-through-iap --quiet
```

---

## 2. Run the cutover

```bash
gcloud compute ssh "$VM" --zone="$ZONE" --tunnel-through-iap --quiet \
  --command="bash /tmp/cutover.sh '$TAG'"
```

Watch the output. Success ends with `[cutover] cutover complete`. If it prints
`healthz did NOT come up`, **stop** and go to [Rollback](#6-rollback); read the
dumped `control` logs first (common causes: a missing required env var, or the
old systemd unit still holding `:4000` — re-check step 1 ran).

---

## 3. Verify

Run these and confirm each expectation. Treat any failure as a reason to
investigate before declaring success.

**Control container is healthy:**

```bash
gcloud compute ssh "$VM" --zone="$ZONE" --tunnel-through-iap --quiet --command="
  cd /opt/coderunner && sudo docker compose ps
"
# Expect: service 'control' STATUS = Up ... (healthy). 'workspace-image' Exited (0) is normal.
```

**Public HTTPS still works through the existing Caddy:**

```bash
DOMAIN=$(gcloud compute ssh "$VM" --zone="$ZONE" --tunnel-through-iap --quiet \
  --command="grep '^DOMAIN=' /etc/coderunner/deploy.env | cut -d= -f2")
curl -sS -I "https://$DOMAIN/healthz"      # expect HTTP/2 200, valid Let's Encrypt cert
```

**Control logs are clean and it's in network mode:**

```bash
gcloud compute ssh "$VM" --zone="$ZONE" --tunnel-through-iap --quiet --command="
  cd /opt/coderunner && sudo docker compose logs --tail 40 control
"
# Expect: 'listening url=http://localhost:4000' and
#         containerNetwork=coderunner in the 'control plane configuration' line.
# A 're-rooted workspace project paths' line is expected on first boot (path normalization).
```

**A workspace container spawns on the shared network with no published ports.**
Have a user open a workspace (or use the admin break-glass to start one), then:

```bash
gcloud compute ssh "$VM" --zone="$ZONE" --tunnel-through-iap --quiet --command='
  set -e
  c=$(docker ps --filter label=frc-sim.managed=true --format "{{.Names}}" | head -1)
  echo "container: $c"
  echo "networks:"; docker inspect "$c" -f "{{json .NetworkSettings.Networks}}" | tr "," "\n" | grep -o "coderunner"
  echo "published ports (expect none):"; docker inspect "$c" -f "{{json .NetworkSettings.Ports}}"
'
# Expect: the container is on the "coderunner" network and Ports is {} (no host bindings).
```

**End-to-end smoke (manual):** open `https://$DOMAIN/`, sign in, load a lesson,
click **Run**, and confirm telemetry/Driver-Station work. This is the real proof
that editor proxy, NT4, and HALSim all resolve over the container network.

**Metrics (host Alloy is unchanged):** confirm the existing Grafana dashboards
still show data — the Prometheus scrape of `localhost:4000/metrics` is unaffected.

> **Known gap (logs):** the old Alloy log pipeline tailed journald for
> `coderunner.service`, which no longer exists — the control plane now logs to
> Docker's json-file driver. **Loki log shipping stops** until you converge to
> the full model (next section), which switches Alloy to the Docker-API log
> source. Metrics keep flowing. Note this so the silence isn't mistaken for an
> outage.

---

## 4. Make reboots durable (gcloud-only)

The VM's boot-time `startup-script` metadata (set by Terraform) still runs the
**old** `render-env.sh`, which rewrites `/opt/coderunner/.env` in the old format
on the next reboot and would break `docker compose` interpolation. Replace the
startup-script so reboots simply bring the compose stack back up:

```bash
cat > /tmp/startup-script.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/coderunner && docker compose up -d --remove-orphans || true
EOF

gcloud compute instances add-metadata "$VM" --zone="$ZONE" \
  --metadata-from-file startup-script=/tmp/startup-script.sh
```

The container's `restart: unless-stopped` policy already brings it back after a
daemon restart; this just makes a full VM reboot reconcile the stack too, without
the old script clobbering `.env`.

> This metadata edit is a stopgap. A later `terraform apply` will reset the
> startup-script (and `user-data`) to the committed compose versions — that is
> the intended durable state. Do not be surprised when Terraform shows this
> metadata as drift.

---

## 5. Converging to the full model

This cutover deliberately leaves **Caddy and Alloy on the host**. To reach the
committed model where they run as compose services (`docker-compose.prod.yml`,
with containerized TLS and the Docker-API log pipeline), do this in a maintenance
window, not during a class:

- **Recommended:** `terraform apply -replace=google_compute_instance.coderunner`.
  The boot disk is recreated with the new cloud-init; the `coderunner-data` disk
  is separate and is preserved with all student data. The fresh boot installs
  Docker + compose, fetches both compose files, renders `.env` and the Alloy
  config from Secret Manager, and runs the full stack. Then dispatch the **Deploy
  to GCE** workflow to pin the release tag. Snapshot the data disk first (step 0).
- This restores Loki log shipping (Alloy reads the control container's logs via
  the Docker API) and puts Caddy in compose. After it, the normal release flow is
  just the GitHub Actions **Deploy to GCE** workflow.

Until you converge, ongoing releases can still be applied in the interim model by
re-running the cutover script with a new `$TAG` (it is idempotent), or by SSHing
in and running `cd /opt/coderunner && sudo sed -i "s/^CODERUNNER_TAG=.*/CODERUNNER_TAG=<tag>/" .env && sudo docker compose pull && sudo docker compose up -d`.

---

## 6. Rollback

If verification fails and you need to restore the bare-metal control plane (the
data disk is untouched throughout):

```bash
gcloud compute ssh "$VM" --zone="$ZONE" --tunnel-through-iap --quiet --command='
  set -e
  cd /opt/coderunner
  sudo docker compose down || true
  sudo cp /opt/coderunner/.env.pre-cutover.bak /opt/coderunner/.env
  sudo systemctl unmask coderunner
  sudo systemctl enable --now coderunner
  for _ in $(seq 1 30); do curl -sf http://localhost:4000/healthz >/dev/null && { echo "bare-metal healthz OK"; break; }; sleep 1; done
'
```

If you also applied the step-4 metadata change, revert it so reboots use the
original behavior:

```bash
gcloud compute instances remove-metadata "$VM" --zone="$ZONE" --keys=startup-script
# (Re-run `terraform apply` afterward to restore the Terraform-managed startup-script.)
```

The data-disk snapshot from step 0 (`$SNAP`) is the deeper fallback if anything
corrupted `/var/lib/coderunner/data` — restore it by creating a new disk from the
snapshot and re-attaching, per the
[Seasonal Teardown](../docs/operating/seasonal-teardown.md) restore steps.
