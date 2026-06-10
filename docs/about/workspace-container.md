---
sidebar_position: 3
title: The Workspace Container
---

# The Workspace Container

Each student gets their own Docker container — one per workspace, started on
demand when they open the IDE, stopped automatically when they have been idle
for a configurable period. This page explains what is inside that container and
how the control plane manages it.

The authoritative reference for the container's runtime contract (bind mounts,
published ports, labels, environment variables, and first-run behavior) is the
[container README on GitHub](https://github.com/mathewdunne/CodeRunner/blob/main/containers/code/README.md).

## What is inside the image

The image (`coderunner-workspace` by default, overridden via `CODE_IMAGE`) is
built on [linuxserver/openvscode-server](https://github.com/linuxserver/docker-openvscode-server)
(Ubuntu 24.04 with s6-overlay process supervision) and adds the following on
top:

| Component | Version |
|---|---|
| openvscode-server | 1.109.5 |
| Adoptium Temurin JDK | 17.0.15+6 (x64) |
| redhat.java (JDT Language Server) | 1.38.0 |
| vscode-wpilib (WPILib extension) | 2026.1.1 |
| Java Extension Pack | debugger, test runner, Maven/Gradle, project manager |
| Spotless Gradle | 1.2.1 |
| GitHub CLI (`gh`) | latest stable at image build time |
| Gradle + WPILib dependency cache | pre-primed at build time |
| Bundled lesson catalog | baked in at `/opt/frc-catalog/` |

The total uncompressed image size is approximately 4.5 GiB, of which roughly
1 GiB is the primed Gradle and WPILib dependency cache that makes first builds
take seconds rather than minutes.

## Classroom-density memory defaults

Running one container per student on shared hardware requires conservative JVM
settings. The image seeds the following defaults at first start:

- **JDT Language Server** capped at `-Xmx512m` (the WPILib extension default
  of `-Xmx8G` is intentionally replaced).
- **Gradle daemon/import** runs with `-Xms64m -Xmx384m`, `--max-workers=2`,
  and `--no-watch-fs`.
- **Robot simulation JVM** capped at `-Xmx256m`.
- The VS Code **Gradle Build Server** path (`java.gradle.buildServer.enabled`)
  is disabled; JDT LS still imports Gradle projects, removing roughly 700 MiB
  of duplicated Gradle infrastructure from the measured peak.

All of these defaults are environment-overridable at container launch time
(see the container README for the full variable list).

The control plane enforces a **hard memory cap** on every container via
Docker's `--memory` flag. The default is `2560m`, controlled by the
`CODE_MEMORY_LIMIT` environment variable on the control plane.

## How student data persists

Student files live on the **host** under `data/users/<workspaceId>/` and are
bind-mounted into the container at known paths:

| Host path | Container path | Contents |
|---|---|---|
| `data/users/<id>/project` | `/workspace/project` | Student source code (authoritative) |
| `data/users/<id>/home` | `/config` | Gradle cache, editor state, VS Code extensions |

Because the mounts outlive any individual container, a student's work survives
the container being stopped, restarted, or recreated. See
[Architecture](./architecture.md) for the full data layout on the host.

## Container ports

Three ports are published inside the container and bound on the **host loopback
interface** (`127.0.0.1`) only — never on a public network interface:

| Container port | Purpose |
|---|---|
| 3000 | openvscode-server (HTTP + WebSocket) |
| 3300 | HALSim WebSocket server (robot enable/disable and mode) |
| 5810 | NT4 NetworkTables server (telemetry) |

The control plane allocates host-side port numbers from configurable ranges
(defaults: `33000–33099` for the editor, `25810–25899` for NT4,
`34000–34099` for HALSim) and records the assignments in its SQLite database.
The browser never connects to these ports directly — all traffic is proxied
through the control plane's single public port.

## Container labels

Every managed container carries four Docker labels that the control plane uses
to identify and reconcile containers across restarts:

```
frc-sim.managed=true
frc-sim.version=v2
frc-sim.role=code
frc-sim.workspace=<workspaceId>
```

On startup, if the control plane finds an existing container with matching
labels and loopback-bound ports, it adopts it rather than creating a new one.
A container without matching labels or with publicly-bound ports is removed and
replaced.

## First-run behavior

On the first start of a fresh workspace (empty `/config` bind mount), an init
script runs before the editor starts:

1. Copies the primed Gradle cache from `/opt/frc-gradle-cache/` into
   `/config/.gradle/`.
2. Copies the pre-installed VS Code extensions from `/opt/frc-extensions-cache/`
   into `/config/extensions/`.
3. Seeds bounded JVM and Gradle settings into editor configuration files.
4. Sets the default VS Code color theme to `Default Dark Modern`.

On subsequent starts these copies are skipped because the directories already
exist. A settings-migration step still runs to lower any legacy `-Xmx8G` JDT
LS setting that may have been imported from a WPILib project.

## Idle auto-stop

The control plane's idle manager checks every 60 seconds (configurable via
`IDLE_CHECK_INTERVAL_MS`) and stops containers whose workspace has not received
a heartbeat within the idle window. The default idle window is **30 minutes**,
controlled by the `IDLE_STOP_MINUTES` environment variable. Stopped containers
are not removed — they are restarted the next time the student opens their
workspace.

## Capacity limit

The control plane refuses to start a new container when the number of running
containers would exceed `MAX_ACTIVE_CONTAINERS` (default: `10`). Students who
hit the limit receive an error rather than causing resource exhaustion on the
host. See [Capacity](../operating/capacity.md) for tuning guidance.
