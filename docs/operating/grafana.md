---
sidebar_position: 7
title: Grafana Cloud (Optional)
---

# Grafana Cloud (Optional)

Grafana Cloud is an optional observability add-on for the cloud VM deployment. The control plane exposes a standard Prometheus metrics endpoint and writes structured JSON logs; this page describes how to wire those up to Grafana Cloud using Grafana Alloy so you can query metrics and logs from anywhere. Nothing in the application itself depends on Grafana Cloud, so this setup is entirely skippable.

## Prerequisites

- A Grafana Cloud account. The free tier (10,000 active series, 50 GB logs, 14-day retention) is sufficient.
- The cloud VM already bootstrapped per [Google Cloud Deployment](../deploying/gcloud.md).

## Getting your credentials

You need five values from the Grafana Cloud portal. Open your stack at [grafana.com](https://grafana.com) and find them as follows:

**Prometheus remote-write URL and instance ID**

Open the **Prometheus / Metrics** card and click **Details**. The remote-write URL looks like:

```
https://prometheus-prod-XX-prod-us-central-0.grafana.net/api/prom/push
```

The numeric instance ID (username) is shown on the same page.

**Loki push URL and instance ID**

Open the **Loki / Logs** card and click **Details**. The push URL looks like:

```
https://logs-prod-XXX.grafana.net/loki/api/v1/push
```

The numeric Loki instance ID is shown separately from the Prometheus one.

**Cloud Access Policy token**

Go to **Security → Access Policies**, create a new policy, and add both `metrics:write` and `logs:write` scopes. Generate a token; one token covers both pipelines. It will look like `glc_eyJ...`.

## Populating GCP Secret Manager

With the values from above, populate the five secrets Terraform created:

```bash
echo -n 'https://prometheus-prod-XX-prod-us-central-0.grafana.net/api/prom/push' \
  | gcloud secrets versions add coderunner-grafana-cloud-url --data-file=-
echo -n '<numeric-prometheus-instance-id>' \
  | gcloud secrets versions add coderunner-grafana-cloud-user --data-file=-
echo -n '<glc_eyJ...-access-policy-token>' \
  | gcloud secrets versions add coderunner-grafana-cloud-token --data-file=-
echo -n 'https://logs-prod-XXX.grafana.net/loki/api/v1/push' \
  | gcloud secrets versions add coderunner-grafana-cloud-loki-url --data-file=-
echo -n '<numeric-loki-instance-id>' \
  | gcloud secrets versions add coderunner-grafana-cloud-loki-user --data-file=-
```

Then re-render the VM's `.env` and restart Alloy:

```bash
gcloud compute ssh coderunner --zone=us-central1-a --tunnel-through-iap \
  --command="sudo /opt/coderunner/render-env.sh && sudo systemctl restart alloy"
```

Secret names are defined in [`deploy/terraform/secrets.tf`](https://github.com/mathewdunne/CodeRunner/blob/main/deploy/terraform/secrets.tf).

## Service management

Alloy runs as a systemd service on the VM:

```bash
sudo systemctl status alloy
sudo systemctl restart alloy
sudo journalctl -u alloy -f
```

## What is shipped

**Metrics:** Alloy scrapes `localhost:4000/metrics` every 30 seconds and remote-writes to Grafana Cloud Prometheus. It also collects host-level metrics (CPU, memory, disk, network) via the built-in Unix exporter, labeled with the `instance` value from `instance_label` in `terraform.tfvars`.

**Logs:** systemd captures the control plane's JSON stdout into journald. `loki.source.journal` in the Alloy config tails the `coderunner.service` unit and ships entries to Loki. The pipeline extracts `level` and `category` as Loki labels; high-cardinality fields like `workspaceId` and `runId` stay in the JSON body and are queried with `| json` at read time.

The `alloy` user must be in the `systemd-journal` group to read journald; the bootstrap script adds it. Without that membership, `loki.source.journal` produces zero entries silently.

## Starter LogQL queries

Find these under **Explore → Loki datasource** in Grafana Cloud:

```logql
# All logs from one student
{unit="coderunner.service"} | json | workspaceId="alice-1"

# All errors
{unit="coderunner.service", level="error"}

# Run lifecycle events with duration
{unit="coderunner.service", category="control.runs"} | json
  | line_format "{{.message}} {{.workspaceId}} {{.durationMs}}ms"

# Container start failures
{unit="coderunner.service", category="control.containers"} |= "failed"
```

To verify Alloy is shipping metrics, run this in **Explore → Prometheus datasource**:

```promql
up{instance="coderunner"}
```

This should return three series, all `1`.

## Dashboards

Six pre-built dashboard JSON files are in the [`dashboards/`](https://github.com/mathewdunne/CodeRunner/tree/main/dashboards) directory at the repo root:

| File | Dashboard |
| --- | --- |
| `01-control-plane-http.json` | CodeRunner — Control Plane HTTP |
| `02-proxy-upstreams.json` | CodeRunner — Proxy Upstreams |
| `03-runs.json` | CodeRunner — Runs |
| `04-containers.json` | CodeRunner — Containers and Workspaces |
| `05-node-process.json` | CodeRunner — Node / Process Health |
| `06-ops-at-a-glance.json` | CodeRunner — Ops at a Glance |

To import them, open Grafana Cloud, go to **Dashboards → Import**, and upload each JSON file. The dashboards assume a Prometheus datasource with the metrics described in [Monitoring](./monitoring.md#what-is-exposed).

## Alloy config location

The rendered Alloy config lives at `/etc/alloy/config.alloy` on the VM. It is regenerated from the template at `/etc/alloy/config.alloy.tmpl` on every boot by `render-env.sh`, which substitutes secrets from GCP Secret Manager. Do not edit `config.alloy` directly; changes are overwritten on next boot. Edit the template instead, then run `render-env.sh` and restart `alloy`.
