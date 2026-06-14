---
sidebar_position: 2
title: Quick Start
---

# Quick Start

This is the fastest way to see CodeRunner running on your own machine. It uses **demo mode**, which skips all of the login and account setup so you can land directly in the editor and try things out. Demo mode is for evaluation only. See the caveats at the end before you put an instance in front of students.

![Landing in the editor in demo mode, ready to pick a lesson](/img/screenshots/demo-mode-landing.png)

## Prerequisites

- **Docker**, up and running, with the **Compose plugin** (`docker compose version`). The control plane, each workspace, and the robot simulation all run inside containers, so Docker is the only hard requirement for the demo.
- **Git.** Clone the repository (a plain ZIP download is fine too — the demo pulls prebuilt images and does not need submodules or Bun).
- **A Unix-like environment is recommended.** WSL2, Linux and macOS are first-class. On Windows, run inside [WSL2](https://learn.microsoft.com/windows/wsl/). See [Platform support](#platform-support) below.

## Steps

Clone the repository:

```bash
git clone https://github.com/mathewdunne/CodeRunner coderunner
cd coderunner
```

Start CodeRunner in demo mode:

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml up
```

(Equivalently, `bun run demo:docker`.) Then open [http://localhost:4000](http://localhost:4000) in your browser. You will land straight in the IDE, ready to pick a lesson and click Run. Stop it with `Ctrl-C`, or run with `-d` to detach.

## What that command does

`docker compose ... up` pulls two images from the GitHub Container Registry and starts the stack:

1. **`coderunner-control`** — the control plane. It already contains the web shell and the prebuilt AdvantageScope Lite assets, so there is nothing to compile and no emscripten or AdvantageScope submodule needed. On start it migrates its SQLite database (under `./data`) and serves on port 4000.
2. **`coderunner-workspace`** — the per-student image with the full Java/WPILib toolchain and the VS Code editor. It is several gigabytes, so the **first** pull takes a while; later runs reuse the cached image.

Student data (the SQLite DB and per-workspace projects) lives in `./data` in the checkout. Delete that directory to reset the demo.

:::note Running from source instead
If you are developing CodeRunner (not just evaluating it), you can run the control plane directly on the host with `bun run dev:control` / `bun run dev:web`, or build a production bundle with `bun run build`. The host path needs Bun and — for a from-source AdvantageScope build — the submodule (`git submodule update --init --recursive`) and emscripten; `bun run setup:demo` downloads prebuilt assets to skip emscripten. See [Local Deployment](./deploying/local.md) and [Development Servers](./development/dev-servers.md).
:::

## Platform support

CodeRunner runs on Linux, macOS, and Windows, but the development experience is not equal across them:

- **Linux and macOS** are first-class. The build and dev loop run at full speed with no extra setup.
- **Native Windows** is fine for the demo, which uses prebuilt assets. For full development (building from source, the dev loop), performance is noticeably worse — file-heavy steps like the AdvantageScope build and the Node/Bun tooling are much slower, largely due to antivirus scanning and slower filesystem access.

If you are developing on Windows, running CodeRunner inside [WSL](https://learn.microsoft.com/windows/wsl/) (a Linux distribution under Windows) is **recommended**. Clone the repository into the WSL filesystem (not a `/mnt/c/...` path) and run all commands from there to get Linux-level performance.

## About demo mode

Demo mode is enabled with the `--demo` flag (or by setting the environment variable `CODERUNNER_DEMO_MODE=1`). It exists so you can evaluate CodeRunner without registering OAuth applications, wiring in client secrets, or adding anyone to an allowlist.

When demo mode is on:

- Authentication is bypassed entirely, so there is no login screen.
- Every visitor resolves to the **same** seeded admin user and shares **one** workspace.
- The server prints a warning banner on startup, and the web UI shows a banner reminding you that you are in demo mode.

Because of that shared identity, demo mode has no privacy boundary between visitors:

> **Never expose a demo instance to the public internet.** Anyone who can reach it is logged in as the same admin and sees the same files. Use demo mode only on your own machine or a trusted local network.

## Where to go next

Demo mode is a tour, not a deployment. To run CodeRunner for a real team, with individual student logins and isolated workspaces, you will set up an OAuth provider and configure who is allowed in:

- [Deploying overview](./deploying/overview.md): the full path to a multi-user instance.
- [OAuth credentials](./deploying/oauth-credentials.md): registering GitHub and/or Google sign-in.
