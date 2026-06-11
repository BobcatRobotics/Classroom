---
sidebar_position: 3
title: Monitoring
---

# Monitoring

## Control-plane logs

The control plane emits structured logs to stdout (info/debug) and stderr
(errors and fatals). The format in development is human-readable:

```
14:23:01.482 INFO  [control.runs]  run started workspaceId=alice-1 runId=run_abc
```

On the cloud VM, `LOG_FORMAT=json` is set in the generated `.env`, so each line
is a single-line JSON object:

```json
{"timestamp":"2026-05-21T14:23:01.482Z","level":"info","category":"control.runs","message":"run started","workspaceId":"alice-1","runId":"run_abc"}
```

### Log verbosity

Set `LOG_LEVEL` to one of: `trace`, `debug`, `info`, `warning`, `error`,
`fatal`. The default is `debug`. The cloud VM uses `info` to reduce noise.
Log categories follow the pattern `control.<subsystem>`, for example
`control.runs`, `control.containers`, `control.auth`, `control.idle`.

ANSI colors are disabled automatically when output is not a TTY (piped to a
file or journald).

### Capturing a session on a local deployment

```bash
bun run start 2>&1 | tee coderunner-$(date +%Y%m%d).log
```

## Prometheus metrics

The control plane exposes Prometheus-format metrics at `GET /metrics`.

### Authentication

`/metrics` requires authentication. If `METRICS_TOKEN` is set, scrapers send
`Authorization: Bearer <token>`. If `METRICS_TOKEN` is not set, the endpoint
falls back to admin session auth (same gate as `/admin/*`).

```bash
# Manual probe
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:4000/metrics
```

Bind the control plane to localhost or a private network interface so scrapers
reach `/metrics` over a trusted path without exposing it to the internet.

### What is exposed

The metrics fall into four categories:

**HTTP traffic**

- `http_request_duration_seconds{method, route, status_class}`: request
  latency. The `route` label is templated (e.g. `/u/:slug/api/sim/status`) to
  keep cardinality bounded.
- `http_requests_in_flight`: concurrent requests being dispatched. A spike
  here combined with rising latency indicates the event loop is saturated.
- `proxy_upstream_duration_seconds{upstream, outcome}`: latency of upstream
  HTTP fetches to `vscode`, `nt4`, `halsim`, and `ascope` upstreams.

**Run pipeline**

- `run_build_duration_seconds`: time from run queue to first sim-ready signal
  (compile + boot).
- `run_active_duration_seconds{terminal_status}`: time spent in `running`
  state before termination.
- `runs_total{terminal_status}`: completed run counter by outcome
  (`stopped` / `failed` / `canceled`).

**Containers**

- `container_start_duration_seconds`: cold-start time to create and start a
  workspace container.
- `container_cpu_percent{workspace_id}`: per-container CPU utilization,
  sampled every 15 s from `docker stats`.
- `container_memory_percent{workspace_id}`: per-container memory usage as a
  percentage of the container limit, sampled every 15 s.
- `active_workspaces`: count of workspaces with a running container at the
  last poll.
- `idle_sweep_stops_total`: workspaces stopped by the idle sweep.

**Process / runtime**

Standard prom-client defaults: `process_cpu_seconds_total`, heap, garbage
collection, and event-loop lag gauges.

## Quick health checks

```bash
# See all managed containers and their state
docker ps --filter label=frc-sim.managed=true

# Per-container CPU and memory (one-shot snapshot)
docker stats --filter label=frc-sim.managed=true --no-stream

# Admin status: workspace list, container states, active build count
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:4000/admin/status | jq .
```

Signs to watch for:

- High `container_memory_percent` approaching 100% means OOM risk; consider
  raising `CODE_MEMORY_LIMIT` or reducing the concurrency cap.
- High `active_workspaces` with slow build durations means CPU headroom is low;
  check the concurrency cap against host sizing (see [Capacity](./capacity.md)).
- If `runs_total{terminal_status="failed"}` is rising, check for build timeouts
  or container OOMs in the logs.

## Grafana Cloud (cloud VM)

On the Google Cloud VM, Grafana Alloy runs as the `alloy` systemd service. It
scrapes `localhost:4000/metrics` every 30 seconds and remote-writes to Grafana
Cloud Prometheus. It also collects host-level metrics (CPU, memory, disk,
network) via the built-in Unix exporter, and ships control-plane logs to
Grafana Cloud Loki.

### Service management

```bash
sudo systemctl status alloy
sudo systemctl restart alloy
sudo journalctl -u alloy -f
```

### How logs are shipped

systemd captures the control plane's JSON stdout into journald.
`loki.source.journal` in the Alloy config tails the `coderunner.service` unit
and ships entries to Loki. The pipeline extracts `level` and `category` as Loki
labels; high-cardinality fields like `workspaceId` and `runId` stay in the JSON
body and are queried with `| json` at read time.

The `alloy` user must be in the `systemd-journal` group to read journald; the
bootstrap script adds it. Without that membership, `loki.source.journal`
produces zero entries silently.

### Starter LogQL queries

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

### Alloy config location

The rendered Alloy config lives at `/etc/alloy/config.alloy` on the VM. It is
regenerated from the template at `/etc/alloy/config.alloy.tmpl` on every boot
by `render-env.sh`, which substitutes secrets from GCP Secret Manager. Do not
edit `config.alloy` directly; changes are overwritten on next boot. Edit the
template instead, then run `render-env.sh` and restart `alloy`.

### Suggested dashboards

There is no pre-built dashboard JSON in this repo. Useful panels to build in
Grafana Cloud:

1. **Control plane**: request rate, error rate, p50/p95/p99 latency by
   `route`, `http_requests_in_flight`, event-loop lag, heap usage.
2. **Runs**: start rate, `run_build_duration_seconds` quantiles,
   `run_active_duration_seconds` by `terminal_status`, failure ratio.
3. **Containers**: `container_cpu_percent` and `container_memory_percent`
   per workspace, `container_start_duration_seconds` histogram,
   `active_workspaces` over time.
4. **Host**: CPU, memory, disk usage from the Unix exporter.
