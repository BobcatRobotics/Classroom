# 033 — Workspace Disk Read Limit

## Status

Accepted.

## Context

A production incident (2026-07-07) froze the entire GCE VM — SSH included —
while a single student workspace built a freshly imported lesson. The
workspace container sat at 99.9% of its `CODE_MEMORY_LIMIT` (then `3200m`)
during a cold Gradle build with the Java language server running. A cgroup
pinned at its memory limit whose pages are mostly reclaimable file cache does
not OOM: the kernel evicts the container's page cache and immediately faults
it back in, indefinitely. Host-wide major page faults went from ~22/s to a
sustained ~3,000/s, and both Hyperdisk Balanced volumes pegged at their
~140 MiB/s provisioned throughput doing pure reads. With the disks saturated,
every process on the host stalled on I/O (load average ~49 on 4 vCPUs) —
the control plane returned 503s for the editor, a concurrent lesson import
failed with `Git clone failed: context canceled`, and SSH could not complete
a login. Host memory was fine (27% used) the entire time, so nothing at the
VM level looked wrong except iowait.

Two aggravating factors are structural:

- Cloud disk throughput is a small, hard budget (a default Hyperdisk Balanced
  volume provisions ~140 MiB/s), shared by every container and the OS.
- Students can import arbitrary GitHub repos, so per-project mitigations
  (e.g. `org.gradle.jvmargs` in lesson templates) cannot be relied on. The
  guard has to be enforced by the host.

## Decision

1. **Throttle workspace container disk reads** with Docker's
   `--device-read-bps`, at `CODE_DISK_READ_LIMIT` (default `64mb`) per
   physical block device. A thrashing (or scanning, or indexing) container now
   degrades itself instead of the host: the kernel throttles its reads, the
   rest of the VM keeps its share of disk throughput, and operators can still
   SSH in and stop the container. Writes are not throttled — the incident
   mode is read thrash, and blanket write caps would slow every normal build.

2. **Auto-detect the device list from `/sys/block`**, filtering virtual
   devices (`loop`, `ram`, `zram`, `dm-*`, `md*`, `nbd*`, `fd*`, `sr*`), only
   when the control plane itself runs in a container (`/.dockerenv`). A
   containerized control plane shares the daemon host's kernel, so its
   `/sys/block` names are exactly the `/dev` paths the daemon resolves. On a
   bare host that assumption breaks for VM-backed daemons (Docker Desktop:
   the daemon's `/dev` belongs to its VM, not the host), so host/dev runs
   apply no limit rather than passing device paths the daemon may reject.
   This mirrors the self-inspection pattern from decision 031: zero-config in
   the deployment that matters, inert in the dev loop.

3. **Raise the default `CODE_MEMORY_LIMIT` from `2560m` to `4096m`** (and the
   production template from `3200m`). The limit that triggered the incident
   was simply smaller than the workload: cold Gradle build + Java LS +
   openvscode-server approach 4 GB. The read cap bounds the blast radius when
   a workload still exceeds its limit; the memory bump makes the normal
   lesson-import path fit without touching the limit at all.

## Alternatives considered

- **blkio weights (`io.weight`)** — proportional sharing would be gentler
  than a hard cap, but it requires the BFQ scheduler, which cloud NVMe
  devices typically don't use. A bps cap works everywhere cgroup v2 does.
- **Per-project JVM caps in lesson templates** — defeated by arbitrary team
  repo imports; kept as guidance, not enforcement.
- **Provisioning more disk throughput** — costs scale with the ceiling, and
  any ceiling can still be saturated by an unthrottled thrash loop.
- **Enumerating devices on the bare host too** — rejected; wrong (and
  container-creation-breaking) under Docker Desktop, and the dev loop is not
  the deployment this protects.

## Consequences

- A single workspace's cold build reads at most 64 MB/s per disk; measured
  against the incident, a full thrash loop now consumes under half of one
  disk's budget instead of all of both.
- Legitimate heavy reads (first Gradle dependency resolution on a cold page
  cache) are slower in the worst case; the Gradle cache priming baked into
  the workspace image keeps the common path largely unaffected.
- Operators can tune or disable per deployment (`CODE_DISK_READ_LIMIT=0`).
- The limit is stamped at container creation, so changes apply on the next
  container restart, same as the memory cap.
