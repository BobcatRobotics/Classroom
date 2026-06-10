---
sidebar_position: 2
title: Quick Start
---

# Quick Start

This is the fastest way to see CodeRunner running on your own machine. It uses **demo mode**, which skips all of the login and account setup so you can land directly in the editor and try things out. Demo mode is for evaluation only — see the caveats at the end before you put an instance in front of students.

## Prerequisites

- **Bun 1.3.13 or newer.** CodeRunner's control plane and tooling run on Bun. Install it from [bun.sh](https://bun.sh).
- **Docker**, up and running. Each workspace and the robot simulation run inside containers, so Docker is required even in demo mode.
- **Git with submodule support.** AdvantageScope is pulled in as a Git submodule, so a plain ZIP download will not work — clone the repository.

## Steps

Clone the repository and fetch its submodules:

```bash
git clone https://github.com/mathewdunne/CodeRunner coderunner
cd coderunner
git submodule update --init --recursive
```

Install dependencies:

```bash
bun install
```

Build the web shell, AdvantageScope assets, and pull the workspace image:

```bash
bun run build
```

Start CodeRunner in demo mode:

```bash
bun run start -- --demo
```

Then open [http://localhost:4000](http://localhost:4000) in your browser. You will land straight in the IDE, ready to pick a lesson and click Run.

## What `bun run build` does

`bun run build` does three things in sequence:

1. Builds the React web shell into a static bundle.
2. Builds the AdvantageScope assets used to render telemetry.
3. Pulls the workspace Docker image (`ghcr.io/mathewdunne/coderunner-workspace:latest`) from the GitHub Container Registry.

That workspace image bundles a full Java/WPILib toolchain and the VS Code editor, so it is several gigabytes. The **first** build will take a while as Docker downloads it; later builds reuse the cached image and are much faster.

## About demo mode

Demo mode is enabled with the `--demo` flag (or by setting the environment variable `CODERUNNER_DEMO_MODE=1`). It exists so you can evaluate CodeRunner without registering OAuth applications, wiring in client secrets, or adding anyone to an allowlist.

When demo mode is on:

- Authentication is bypassed entirely — there is no login screen.
- Every visitor resolves to the **same** seeded admin user and shares **one** workspace.
- The server prints a warning banner on startup, and the web UI shows a banner reminding you that you are in demo mode.

Because of that shared identity, demo mode has no privacy boundary between visitors:

> **Never expose a demo instance to the public internet.** Anyone who can reach it is logged in as the same admin and sees the same files. Use demo mode only on your own machine or a trusted local network.

## Where to go next

Demo mode is a tour, not a deployment. To run CodeRunner for a real team — with individual student logins and isolated workspaces — you will set up an OAuth provider and configure who is allowed in:

- [Deploying overview](./deploying/overview.md) — the full path to a multi-user instance.
- [OAuth credentials](./deploying/oauth-credentials.md) — registering GitHub and/or Google sign-in.
