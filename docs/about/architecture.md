---
sidebar_position: 1
title: Architecture
---

# Architecture

CodeRunner is a self-hosted web application that gives each student a full
Java IDE and an FRC robot simulator in the browser. There is no software for
students to install: they open a URL, sign in, write code, and click **Start**
in the built-in Driver Station.

At a high level there are three moving parts:

1. **The browser**: a React single-page app (the "web shell") that wraps the
   editor with Driver Station controls and live telemetry.
2. **The control plane**: a single Bun/TypeScript server that handles sign-in,
   sessions, workspace orchestration, and all proxying. It is the only thing
   exposed to the network.
3. **Per-student workspace containers**: one Docker container per student,
   each running a browser editor plus the Java toolchain and WPILib simulator.

```text
                 Browser (one student)
   ┌───────────────────────────────────────────────┐
   │  Web shell (React)                              │
   │  ├─ VS Code editor (iframe)                     │
   │  ├─ Driver Station controls                     │
   │  └─ AdvantageScope Lite telemetry (iframe)      │
   └───────────────────────────────────────────────┘
                        │  HTTPS / WSS  (one port, default 4000)
                        ▼
   ┌───────────────────────────────────────────────┐
   │  Control plane (Bun/TypeScript)                 │
   │  ├─ Auth + sessions (OAuth, allowlist)          │
   │  ├─ Workspace orchestration (start/stop)        │
   │  ├─ Authenticated proxy → editor / sim / NT4    │
   │  ├─ Run pipeline (build + simulate)             │
   │  └─ SQLite (users, sessions, leases, audit)     │
   └───────────────────────────────────────────────┘
                        │  loopback ports, or a private Docker network
                        │  with no published ports (deployment-dependent)
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   ┌─────────┐    ┌─────────┐     ┌─────────┐
   │ student │    │ student │     │ student │   ← one container each
   │container│    │container│     │container│
   └─────────┘    └─────────┘     └─────────┘
     editor + JDK + Gradle + WPILib + simulator
```

The control plane itself typically runs as a container too — the standard
deploy is `docker compose up`, with the control image managing per-student
containers as Docker siblings over the bind-mounted host socket. See
[decision 031](https://github.com/mathewdunne/CodeRunner/blob/main/docs/decisions/031-containerized-control-plane.md) for that
packaging and the two ways it reaches student containers, below.

## The single front door

Everything a browser talks to goes through **one HTTP/WebSocket port** on the
control plane (default `4000`, set by the `PORT` environment variable). The web
shell, the editor traffic, the Run commands, and the telemetry feeds all share
that port. Students never connect to a container directly. This is what makes
CodeRunner safe to put behind a single reverse proxy and TLS certificate.

## What the control plane does

The control plane is a single Bun process. Its responsibilities:

- **Authentication and sessions.** Sign-in is OAuth (GitHub and/or Google).
  Only emails on an allowlist may sign in. Sessions are tracked with a signed
  cookie. See the [Security Model](./security-model.md) for details.
- **Workspace orchestration.** On a student's first sign-in the control plane
  creates their workspace and, when they open it, starts their Docker
  container. Depending on deployment mode it either publishes loopback host
  ports for that container (**port mode**, the host dev loop) or joins it to a
  shared Docker network with no published ports and proxies to it by container
  name (**network mode**, the default for `docker compose` deployments). Either
  way it applies management labels, enforces a per-container memory cap, and
  stops idle containers automatically.
- **Authenticated proxying.** All editor traffic, the simulator's control
  channel, and the NetworkTables telemetry stream are reverse-proxied through
  authenticated routes scoped to the signing-in user's own workspace. A student
  cannot reach another student's container.
- **The Run pipeline.** When a student clicks Run, the control plane drives a
  Gradle build inside that student's container and then launches the simulated
  robot program, streaming build and program output back to the browser.

## How a Run works

A Run is a two-phase operation inside the student's own container:

1. **Build.** Gradle compiles the project. Build output streams live to the
   browser console. If the build fails, the Run stops and the error is shown.
2. **Simulate.** The control plane launches the robot program in WPILib's
   simulator. The program exposes a **HALSim WebSocket** (so the browser's
   Driver Station can enable/disable the robot and set teleop/auto/test modes)
   and a **NetworkTables (NT4)** server (so telemetry can be visualized).

The control plane watches the program's output and reports the Run as
"running" once the simulator is listening. There are configurable timeouts for
the build and for simulator startup (defaults: build `90s`, startup `30s`).

## How telemetry flows

The running robot program publishes telemetry to its NetworkTables server
inside the container. AdvantageScope Lite, embedded in the browser as an
iframe, subscribes to that data over NT4. Because containers are never exposed
to the browser, the NT4 stream is proxied through the control plane: the robot
program's NT4 server (loopback) → control plane proxy → AdvantageScope in the
browser. The student sees field positions, signals, and plots update in real
time as their robot runs.

## Persistence and data layout

The control plane uses a single **SQLite** database (`data/app.db` by default)
for users, sessions, workspace records, container port leases, and the audit
log. There is no separate database server to run.

Student files live on the host under a predictable layout, one directory per
workspace:

```text
data/
├─ app.db                         control-plane database (SQLite)
├─ allowlist.json                 who is allowed to sign in
└─ users/
   └─ <workspaceId>/
      ├─ project/                 the student's code (authoritative)
      ├─ home/                    editor state, extensions, Gradle cache
      └─ logs/                    Run logs
```

Each container bind-mounts that student's `project/` and `home/` directories,
so a student's work survives the container being stopped, restarted, or
recreated. See [The Workspace Container](./workspace-container.md) for the
container side of this contract.

## Where to go next

- [Using CodeRunner](../using-coderunner.md): the short student guide.
- [The Workspace Container](./workspace-container.md): what is inside each
  student container.
- [Security Model](./security-model.md): how access is gated and isolated.
- [Quick Start (Installation)](../quick-start.md): try it locally.
- [Deploying](../deploying/overview.md): run it for a real team.
