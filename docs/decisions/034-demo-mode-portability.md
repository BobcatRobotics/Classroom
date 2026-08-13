# 034 — Demo mode portability on Docker Desktop

Status: **Accepted (implementation)** — 2026-08-13

Extends [`028-demo-mode.md`](./028-demo-mode.md) and
[`033-workspace-disk-read-limit.md`](./033-workspace-disk-read-limit.md).

## Context

Testing the out-of-the-box experience on native Windows surfaced two problems
that only appear off Linux, both traced to Docker Desktop's WSL2 backend.

**The control plane could not start at all.** It runs non-root and reaches the
Docker socket through the supplementary group in `CODERUNNER_DOCKER_GID`, whose
default assumes a Linux host with a `docker` group. Inside Docker Desktop's VM
the socket is `root:root`, so the default never matched and every start died in
`selfInspect` — with a message naming three `FRC_*` variables, none of which can
fix a permission problem.

**First boot took minutes.** Bind mounts of Windows paths are served over 9p
across the VM boundary, where cost is per filesystem operation rather than per
byte. Measured on the affected machine: streaming bandwidth was tolerable, but
each additional file cost roughly 20 ms, making the same payload split across
~2k files about 14× slower than on a VM-local volume, and metadata-only work
(`chown -R`) far worse. The workspace image seeds several thousand files of
Gradle cache and extensions into `/config` on first run and re-chowns that tree
on every start, so the editor readiness probe timed out repeatedly and the UI
showed an indefinite spinner.

## Decision

1. **`group_add` lists both the configured docker gid and root, always.**
   Whichever does not apply to the host is inert. This is not scoped to demo
   mode, because it does not need to be: supplementary groups do not affect the
   ownership of files a process creates (that follows the primary gid), so
   `./data` stays host-owned, which is the entire purpose of the non-root design
   in [031](./031-containerized-control-plane.md). An audit of the control image
   found gid 0 uniquely grants access to exactly three files — `dpkg/lock`,
   `dpkg/lock-frontend`, `apt/archives/lock` — and nothing group-writable. The
   process is also handed the Docker socket by design, which is already
   root-equivalent on the host, so withholding gid 0 inside the container buys
   nothing.

   Considered and rejected: a `docker-compose.demo.yml` overlay, which would
   have reversed 031's "demo mode is an env passthrough, not an override file"
   and cost every doc an extra `-f` flag, to avoid a risk the audit showed was
   not there. `CODERUNNER_DEMO_MODE=1 docker compose up` is unchanged.

   Cost: setting `CODERUNNER_DOCKER_GID=0` now duplicates the entry and compose
   rejects the file. Documented where the variable is described.

2. **`/config` is a named volume in demo mode**, a host bind mount otherwise.
   Everything under it is regenerable (Gradle caches, extensions, editor state,
   and — per 010 — the sim project cache, so build output too), and `backup.ts`
   already excludes it. A volume lives on the VM's own filesystem, so demo
   performance stops depending on the host OS. Real deployments keep the bind
   mount, which lands the caches on `CODERUNNER_HOST_DATA_DIR` (often a
   dedicated disk) and keeps them visible to the operator.

   `project/` stays a bind mount in both modes: it is the student's actual code
   and backups read it from the host. Volume deletion is wired to workspace
   deletion only — container recycling must keep the volume, or every restart
   re-seeds.

3. **The disk read cap is skipped in demo mode.** Per 033 it exists to stop one
   thrashing container from saturating a shared VM's provisioned throughput. A
   single-workspace demo on someone's own machine has no such tenant, and the
   cap only throttles seeding and Gradle reads.

4. **Editor 503s distinguish "starting" from "failed"** via a response header,
   so the shell can say so instead of showing a spinner that reads as hung.

## What was deliberately not done

The per-start `lsiown -R` over `/config` is real waste — measured at ~47 s on the
affected machine, versus a fraction of a second on Linux ext4 — and the obvious
fixes were rejected:

- **Chowning at build time does not work.** `abc`'s uid is assigned at runtime
  from `PUID`/`PGID`, which the control plane derives per deployment from the
  data dir's owner. The image already chowns the Gradle cache at build time and
  it still needs the runtime pass.
- **Guarding the chown on a uid marker is not safe today.** `docker exec` runs
  as root and `start-sim.sh` does not drop privileges, so builds write
  root-owned files into the Gradle home the editor uses as `abc`. The
  unconditional chown is the repair pass that launders them on the next start;
  frequent idle-stop restarts are why this has never surfaced. Guarding it would
  convert a masked problem into a live one.

Both would be unblocked by making the exec path run as `abc`. Until then the
chown stays, and the demo-mode volume makes it cheap enough not to matter. Note
the hidden coupling: raising `IDLE_STOP_MINUTES` substantially, or making that
chown conditional, would expose the root-owned-cache problem with no obvious
connection to the change.

## Consequences

- The demo runs identically on Linux, macOS, WSL2, and native Windows with no
  configuration. Native Windows remains unsuitable for real deployments, where
  the caches sit on a host bind mount.
- Resetting a demo now means clearing the volume as well as `./data`.
- Demo mode no longer exercises the same storage path as production. This is a
  deliberate fidelity trade, and an argument for keeping demo's divergence to
  these settings rather than letting it grow.
- Startup socket failures now surface docker's own stderr, and a denied socket
  names `CODERUNNER_DOCKER_GID` instead of the three `FRC_*` variables that
  cannot fix it. The previous troubleshooting entry described a symptom
  (`permission denied` in the logs) that never actually appeared, because the
  inspect wrapper discarded stderr.
