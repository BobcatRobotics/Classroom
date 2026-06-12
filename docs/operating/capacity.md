---
sidebar_position: 4
title: Capacity and Sizing
---

# Capacity and Sizing

## Per-student resource usage

Each active student runs one workspace container. Approximate resource
consumption per active student:

| Resource | Steady-state | Peak (during build) |
|---|---|---|
| RAM | ~1.0–1.5 GB | ~1.5–2.5 GB |
| CPU | minimal (idle) | 1–2 cores |
| Disk (project files) | ~50 MB | ~50 MB |
| Disk (Gradle/editor caches) | ~500 MB | ~500 MB |

Reserve roughly 4 GB for the OS, Docker daemon, and browser overhead on the
host itself.

## Container memory cap

Each container is hard-limited to `CODE_MEMORY_LIMIT` (default: `2560m`). If a
container exceeds its limit, the Linux OOM killer terminates a process inside it.
The student typically sees a failed run; the container itself keeps running.

The cloud VM deployment uses `3200m` to give the heavier openvscode-server and
Java language server more headroom.

Adjust in your `.env`:

```bash
# Tighter cap for a memory-constrained host
CODE_MEMORY_LIMIT=2048m

# More headroom if containers OOM during builds
CODE_MEMORY_LIMIT=3072m
```

Changing `CODE_MEMORY_LIMIT` requires a control-plane restart to take effect for
newly started containers. Already-running containers are not affected until they
are next restarted.

## Host sizing guidance

| Students | RAM | CPU | Disk | Notes |
|---|---|---|---|---|
| 1–3 | 16 GB | 4 cores | 30 GB | Development or testing |
| 4–6 | 16–24 GB | 4–6 cores | 40 GB | Small classroom; consider lowering `CODE_MEMORY_LIMIT` to `2048m` |
| 7–10 | 32 GB | 6+ cores | 50 GB | Full classroom; preferred target |
| 10+ | 48+ GB | 8+ cores | 80 GB | Large classroom; increase `CODE_MEMORY_LIMIT` and cap |

The Google Cloud default VM is a `c4-standard-4` (4 vCPU / 15 GB RAM) with a
50 GB data disk, sized for a small-to-medium classroom. Verify the current
machine type in
[`deploy/terraform/vm.tf`](https://github.com/mathewdunne/CodeRunner/blob/main/deploy/terraform/vm.tf).

## Concurrency cap

`MAX_ACTIVE_CONTAINERS` (default: `10`) is an admission-control gate: when a
student tries to open their workspace and the cap is already reached, the server
returns HTTP 503 and the browser shows a "Server at capacity" toast. Students
with already-running containers are not affected.

The cap can be changed at runtime without a restart; see
[Day-to-Day Operations](./day-to-day.md#container-concurrency-cap).

Set a conservative cap relative to available RAM. A rough rule: multiply
available RAM (after the 4 GB OS reserve) by 0.6 and divide by
`CODE_MEMORY_LIMIT` in GB:

```
available_for_containers = total_RAM - 4 GB
safe_cap ≈ available_for_containers × 0.6 ÷ CODE_MEMORY_LIMIT_GB
```

For a 32 GB host with `CODE_MEMORY_LIMIT=2560m`:
`(32 - 4) × 0.6 ÷ 2.5 ≈ 6–7 containers` with comfortable headroom for
simultaneous builds.

## Measuring actual usage

```bash
# Per-container CPU and memory (one-shot)
docker stats --filter label=frc-sim.managed=true --no-stream
```

On the cloud VM, `container_cpu_percent` and `container_memory_percent` metrics
(per workspace, sampled every 15 s) are available as Prometheus metrics and, if
Grafana Cloud is configured, show trends over time there (see
[Grafana Cloud](./grafana.md)). Use those to confirm that your memory cap and
concurrency limit are well-matched to actual student behaviour.

## Disk growth

Student caches grow over time. The main contributors are:

- **Gradle cache** (`data/users/*/home/`): grows per workspace as new
  dependencies are downloaded. Typically reaches 300–500 MB per student after a
  few builds.
- **Run logs** (`data/users/*/logs/`): appended on every build and run.
- **Docker layer cache** on the host: grows when you rebuild or update the
  workspace image.

### Checking disk usage

```bash
# Overall free space
df -h /

# Size of the data directory
du -sh data/

# Per-workspace breakdown (approximate)
du -sh data/users/*/
```

### Cleaning up

Remove stopped managed containers (does not affect running containers or
student files):

```bash
bun run docker:cleanup

# Preview first
bun run docker:cleanup -- --dry-run
```

Prune Gradle caches and run logs for a specific student (stop their container
first):

```bash
rm -rf data/users/<workspaceId>/home/
mkdir -p data/users/<workspaceId>/home
rm -rf data/users/<workspaceId>/logs/runs/*
```

Prune all regenerable data across all workspaces (containers must be stopped):

```bash
for dir in data/users/*/; do
  rm -rf "$dir/home" "$dir/logs"
  mkdir -p "$dir/home" "$dir/logs/runs"
done
```

Clean up dangling Docker images and build cache:

```bash
docker system prune -f
docker builder prune -f
```

Never delete `data/users/*/project/`; that is the student's source code.
Back it up first if you are unsure (see [Backups](./backups.md)).
