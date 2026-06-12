---
sidebar_position: 1
title: Development Servers
---

# Development Servers

This page covers the day-to-day inner loop for working on CodeRunner: getting the
repo running locally, the two dev servers, and the gates to run before you call a
change done. If you just want to stand up the whole app, start with the
[Quick Start](../quick-start.md). For the big picture of how the pieces fit, see
the [architecture overview](../about/architecture.md).

## First-time setup

CodeRunner is TypeScript on [Bun](https://bun.sh). All non-container code uses Bun
for package management, script execution, and the control-plane runtime.

```bash
bun install
git submodule update --init --recursive
```

The submodule step pulls the pinned `vendor/AdvantageScope` checkout, which the
telemetry build (`bun run build:ascope`) depends on.

:::note Windows
On Windows the AdvantageScope step may appear to hang the first time (it stalls
while bundling/minifying the large `hub.js` renderer, often for a minute or two).
If it seems stuck, cancel and re-run the build. The second run usually proceeds
quickly. Building under WSL avoids the slowdown entirely.
:::

## Repo layout

A one-line map of the top-level directories you'll touch most:

- `apps/control/`: Bun control plane (HTTP, WebSocket, sessions, container orchestration, the editor/run/telemetry proxies).
- `apps/web/`: React + Vite browser IDE shell.
- `packages/contracts/`: shared API schemas, message types, and path rules consumed by both sides.
- `containers/code/`: the merged openvscode-server + simulator Docker image (see [Workspace Image](./workspace-image.md)).
- `catalog/`: bundled, zero-config lesson catalog baked into the workspace image.
- `e2e/`: Playwright end-to-end tests and fixtures.
- `scripts/`: TypeScript utility scripts run by Bun (build, backup, cleanup, user admin).
- `docs/`: this documentation site.

## The two dev servers

You'll usually run both at once, in separate terminals.

### Control plane: `bun run dev:control`

```bash
bun run dev:control
```

This runs the control plane with Bun's `--watch` flag, so it restarts on source
changes. It listens on **port 4000** (override with the `PORT` env var) and serves
the prebuilt web bundle from `apps/web/dist/` alongside the API and WebSocket
routes. If you only change backend code, this server plus a built web bundle is
all you need.

#### Demo mode

Demo mode bypasses authentication and seeds a single `demo` user, which is handy
for poking at the app without setting up an OAuth provider:

```bash
bun run dev:control -- --demo
```

The `--demo` flag (or the `CODERUNNER_DEMO_MODE` env var) is read at startup. Do
not enable it for anything reachable by real students.

### Web shell: `bun run dev:web`

```bash
bun run dev:web
```

This starts the Vite dev server on **port 5173** with hot module replacement.
Vite proxies API, health, metrics, AdvantageScope, admin, and per-user
(`/u/<id>/…`) traffic, including WebSocket upgrades, to the control plane at
`http://localhost:4000`. The proxy config lives in `apps/web/vite.config.ts`, so
front-end changes hot-reload at `http://localhost:5173` while every backend call
is forwarded to `dev:control`. Run both servers together for the full HMR loop.

## Database migrations

The control plane uses SQLite. Migrations are applied by `apps/control/src/migrate.ts`
and discovered from the migrations directory resolved in
`apps/control/src/config.ts` (defaults to `apps/control/src/migrations`, the
`migrations.ts` module).

```bash
bun run migrate          # apply all pending migrations
bun run migrate:status   # list each migration and whether it's applied
```

`bun run start` runs `migrate` before serving, so production boots always migrate
first. In dev, run `bun run migrate` yourself after pulling changes that add a
migration. Migrations target the configured `dbPath` (under `data/` by default).

## Code style and CI gates

Formatting, linting, and import organization are handled by [Biome](https://biomejs.dev).

Run this before finalizing any code change; it applies Biome's safe lint fixes,
formatting, and import organization in one pass:

```bash
bun run check:fix
```

For the full local equivalent of CI, run:

```bash
bun run verify
```

`verify` runs `biome ci .` (which fails on any unfixed lint/format issue), then
`bun run typecheck`, then all four test tiers in order: `test`, `test:web`,
`e2e`, and `e2e:security`. Typechecking spans the contracts, control, web, and
scripts TypeScript projects. See [Testing](./testing.md) for what each tier
covers, and the [CLI reference](../reference/cli-reference.md) for the full
script list.
