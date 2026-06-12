---
sidebar_position: 2
title: Quick Start
---

# Quick Start

This is the fastest way to see CodeRunner running on your own machine. It uses **demo mode**, which skips all of the login and account setup so you can land directly in the editor and try things out. Demo mode is for evaluation only. See the caveats at the end before you put an instance in front of students.

![Landing in the editor in demo mode, ready to pick a lesson](/img/screenshots/demo-mode-landing.png)

## Prerequisites

- **Bun 1.3.13 or newer.** CodeRunner's control plane and tooling run on Bun. Install it from [bun.sh](https://bun.sh).
- **Docker**, up and running. Each workspace and the robot simulation run inside containers, so Docker is required even in demo mode.
- **Git.** Clone the repository (a plain ZIP download is fine too, since demo mode uses prebuilt assets and does not need submodules).
- **A Unix-like environment is recommended.** WSL, Linux and macOS are first-class. On Windows, the demo loop works fine, but the full development loop performs noticeably worse, so running inside [WSL](https://learn.microsoft.com/windows/wsl/) is recommended for development. See [Platform support](#platform-support) below.

## Steps

Clone the repository:

```bash
git clone https://github.com/mathewdunne/CodeRunner coderunner
cd coderunner
```

Install dependencies:

```bash
bun install
```

Fetch the prebuilt web shell and AdvantageScope assets, and pull the workspace image:

```bash
bun run setup:demo
```

Start CodeRunner in demo mode:

```bash
bun run demo
```

Then open [http://localhost:4000](http://localhost:4000) in your browser. You will land straight in the IDE, ready to pick a lesson and click Run.

## What `bun run setup:demo` does

`bun run setup:demo` does two things in sequence:

1. Pulls the workspace Docker image (`ghcr.io/mathewdunne/coderunner-workspace:latest`) from the GitHub Container Registry.
2. Downloads the prebuilt web shell and AdvantageScope assets from the latest GitHub release and unpacks them into `apps/web/dist` and `dist/advantagescope`.

Using the prebuilt release assets means the demo does **not** compile AdvantageScope from source, so you do not need emscripten or the AdvantageScope submodule — the step that makes a full source build slow (and Windows-finicky).

That workspace image bundles a full Java/WPILib toolchain and the VS Code editor, so it is several gigabytes. The **first** setup will take a while as Docker downloads it; later runs reuse the cached image and are much faster.

:::note Building from source instead
If you are developing CodeRunner (not just evaluating it), build the assets from source with `bun run build` instead. That requires the AdvantageScope submodule (`git submodule update --init --recursive`) and emscripten. See [Local Deployment](./deploying/local.md).
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
