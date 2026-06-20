---
sidebar_position: 1
title: Configuration Reference
---

# Configuration Reference

CodeRunner is configured entirely through environment variables. Copy `.env.example` to `.env` in the repo root and edit only the values you need; the defaults are reasonable for local use. The control plane reads `.env` once at startup; restart the process to apply any changes.

:::note Docker Compose deployments
With the containerized control plane (the default deployment — see [decision 031](https://github.com/mathewdunne/CodeRunner/blob/main/docs/decisions/031-containerized-control-plane.md)) the same `.env` is read twice: Compose interpolates the `CODERUNNER_*` values (see [Docker Compose deployment](#docker-compose-deployment) below) into `docker-compose*.yml`, and the whole file is passed into the control container. The image **fixes the in-container paths** (`/data`, `/app/...`) and sets `FRC_CONTAINER_NETWORK` itself, so the **Paths** section below and the `bun run build:*` notes apply only to a from-source host run — leave them unset for a compose deployment.
:::

## Server

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4000` | HTTP and WebSocket listen port. |

## Paths

These rarely need changing in a standard deployment. Override them only if you need to relocate runtime data (for example, to a larger disk on a cloud VM).

| Variable | Default | Purpose |
|----------|---------|---------|
| `FRC_DATA_DIR` | `data/` (repo root) | Runtime data root: the SQLite database, student project files, allowlist, and backups all land here. |
| `FRC_DB_PATH` | `{FRC_DATA_DIR}/app.db` | Path to the SQLite database file. Defaults to `app.db` inside `FRC_DATA_DIR`. |
| `FRC_MIGRATIONS_DIR` | auto-detected from source | Path to DB migration files. Leave unset unless you are running a non-standard layout. |
| `FRC_WEB_DIST_DIR` | `apps/web/dist` | Built React web shell assets. Must exist before starting; run `bun run build:web` first. |
| `FRC_ASCOPE_DIST_DIR` | `dist/advantagescope` | Built AdvantageScope Lite assets. Populated by `bun run build:ascope`. |

## Lessons Catalog

CodeRunner has two catalog sources behind one interface. When `LESSONS_CATALOG_REPO` is not set the bundled `catalog/` directory (baked into the workspace image) is used; this works offline with no configuration. Set the repo variable to pull lessons from a remote public GitHub repository instead, which lets you update lesson content without rebuilding the Docker image.

| Variable | Default | Purpose |
|----------|---------|---------|
| `LESSONS_CATALOG_REPO` | none | Remote lessons repo, as an `owner/repo` slug or full `https://` URL. When unset, the bundled catalog is used. |
| `LESSONS_CATALOG_BRANCH` | `main` | Branch to check out from the remote lessons repo. Ignored when `LESSONS_CATALOG_REPO` is unset. |
| `LESSONS_CATALOG_DIR` | `catalog/` (repo root) | Path to the bundled catalog. Only needed if you relocate the bundled catalog directory. |

See [Lessons overview](../lessons/overview.md) and [Authoring modules](../lessons/authoring-modules.md) for catalog structure.

## Auth and OAuth

OAuth credentials are required for multi-user production deployments. At least one provider (GitHub or Google) must be configured for login to work. Register your OAuth app at the provider and set the callback URL to `$BETTER_AUTH_URL/api/auth/callback/github` or `$BETTER_AUTH_URL/api/auth/callback/google`.

See [OAuth credentials](../deploying/oauth-credentials.md) for step-by-step registration instructions.

| Variable | Default | Purpose |
|----------|---------|---------|
| `BETTER_AUTH_SECRET` | `frc-local-dev-session-secret-change-me` | Session signing secret. **Change this for any production deployment.** Use a random 32+ character string. |
| `BETTER_AUTH_URL` | `http://localhost:{PORT}` | Public base URL of the app. OAuth providers redirect back to this URL; it must be reachable by the browser. |
| `GITHUB_CLIENT_ID` | none | GitHub OAuth app client ID. |
| `GITHUB_CLIENT_SECRET` | none | GitHub OAuth app client secret. |
| `GOOGLE_CLIENT_ID` | none | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | none | Google OAuth client secret. |
| `CODERUNNER_DEMO_MODE` | `false` | When `1` or `true`, bypasses authentication entirely. All visitors share one admin session. Never expose a demo instance publicly. Also enabled with the `--demo` CLI flag on startup. |

## Docker and Containers

| Variable | Default | Purpose |
|----------|---------|---------|
| `FRC_DOCKER_PATH` | `docker` | Path to the Docker CLI binary. Override if Docker is not on `PATH`. |
| `CODE_IMAGE` | `coderunner-workspace` | Docker image name for student workspace containers. |
| `CODE_MEMORY_LIMIT` | `2560m` | Memory cap applied to each workspace container via Docker `--memory`. Lower to `2048m` if the host is RAM-constrained. |
| `SIM_PORT_RANGE` | `25810-25899` | Loopback port range allocated for HALSim NT4 connections. Format: `start-end`. |
| `VSCODE_PORT_RANGE` | `33000-33099` | Loopback port range for openvscode-server instances. Format: `start-end`. |
| `HALSIM_PORT_RANGE` | `34000-34099` | Loopback port range for HALSim WebSocket bridges. Format: `start-end`. |
| `FRC_CONTAINER_AUTO_START` | `true` | Automatically start a student's workspace container when their session page loads. Also readable as `CONTAINER_AUTO_START`. |
| `FRC_CONTAINER_USER` | auto-detected | UID:GID for container processes. On Linux defaults to the current user's UID and GID, keeping file ownership consistent with bind-mounted project directories. Also configurable via `FRC_UID` + `FRC_GID` separately. |
| `FRC_CONTAINER_NETWORK` | none | Docker network that workspace containers join instead of publishing loopback host ports. Set (to `coderunner`) by `docker-compose.yml` when the control plane runs in a container; the control plane then reaches workspaces by container name over the network. Leave **unset** for a host/dev run (`bun run dev:control`) — a host process can't resolve container DNS names. |
| `FRC_HOST_DATA_DIR` | none | Host-side absolute path of `FRC_DATA_DIR`, used to translate workspace bind-mount sources when the control plane itself runs in a container (the Docker daemon resolves mounts against the host). Set by `docker-compose.yml`; leave unset on the host. |

When `FRC_CONTAINER_NETWORK` is set and the control plane runs as root (the containerized case), `FRC_CONTAINER_USER` is **required** — otherwise the control plane refuses to start, to avoid root-owning student files on the host. Compose supplies it from `CODERUNNER_WORKSPACE_UID`/`GID`.

Each active student workspace uses approximately 2.5 GB of RAM at the default memory cap. See [Capacity planning](../operating/capacity.md) for host sizing guidance.

## Docker Compose deployment

These variables are consumed by `docker compose` itself (interpolated into `docker-compose*.yml`), **not** read directly by the control plane. They only apply to the containerized deployment; see [Local Deployment](../deploying/local.md) and [decision 031](https://github.com/mathewdunne/CodeRunner/blob/main/docs/decisions/031-containerized-control-plane.md).

| Variable | Default | Purpose |
|----------|---------|---------|
| `CODERUNNER_TAG` | `latest` | Image tag to run for both the control and workspace images (a release tag like `v2.5.0`, or `latest`). |
| `CODERUNNER_HOST_DATA_DIR` | `${PWD}/data` | Absolute **host** path of the data directory, bind-mounted into the control container at `/data` and passed through as `FRC_HOST_DATA_DIR`. |
| `CODERUNNER_WORKSPACE_UID` | `1000` | Host UID that owns the data directory; workspace containers run as this user (supplied to the control plane as `FRC_CONTAINER_USER`). |
| `CODERUNNER_WORKSPACE_GID` | `1000` | Host GID counterpart to `CODERUNNER_WORKSPACE_UID`. |
| `COMPOSE_FILE` | none | Production VM only: selects the prod stack (`docker-compose.yml:docker-compose.prod.yml`) so a plain `docker compose up -d` runs Caddy + Alloy too. |

## Run Lifecycle

These control how long the control plane waits during a build-and-run cycle before giving up.

| Variable | Default | Purpose |
|----------|---------|---------|
| `RUN_BUILD_TIMEOUT_MS` | `90000` | Maximum time (ms) to wait for `gradle build` to complete before reporting a build timeout. |
| `SIM_STARTUP_TIMEOUT_MS` | `30000` | Maximum time (ms) to wait for the simulator to become ready after a successful build. |

The first build is always slower: Gradle downloads dependencies and warms up the JVM. Subsequent builds hit the cache and complete in a few seconds. See [FAQ: why is the first run slow?](./faq.md#why-is-the-first-build-or-run-slow) for details.

## Idle Management

The idle manager periodically checks active containers and stops those that have not been used recently. This frees host RAM between sessions without requiring manual intervention.

| Variable | Default | Purpose |
|----------|---------|---------|
| `IDLE_STOP_MINUTES` | `30` | Stop a workspace container after this many minutes of inactivity. |
| `IDLE_CHECK_INTERVAL_MS` | `60000` | How often (ms) the idle sweep runs. |

## Admin and Metrics

| Variable | Default | Purpose |
|----------|---------|---------|
| `ADMIN_TOKEN` | none | Bearer token accepted by `/admin/*` endpoints as an alternative to an admin user session. Useful as a break-glass bootstrap token before any admin user has signed in. Leave unset to require a signed-in admin session. |
| `MAX_ACTIVE_CONTAINERS` | `10` | Hard cap on simultaneously running workspace containers. New workspace requests beyond this limit are rejected until a slot is freed. |

See [Monitoring](../operating/monitoring.md) for the `/metrics` Prometheus endpoint.

## Logging

| Variable | Default | Purpose |
|----------|---------|---------|
| `LOG_LEVEL` | `debug` (non-test), `warning` (test) | Control plane log verbosity. Valid values: `trace`, `debug`, `info`, `warning`, `error`, `fatal`. The alias `warn` is accepted. |
| `LOG_FORMAT` | `text` | Log output format. `text` is colored and human-readable for local development. `json` emits NDJSON for log shipping (for example, Grafana Alloy to Loki in cloud deployments). |

## Demo mode and the `--demo` flag

Demo mode (`CODERUNNER_DEMO_MODE=1`) can also be activated at startup with the command-line flag:

```bash
bun run start -- --demo
```

The flag takes precedence and sets the same behavior: authentication is skipped, every visitor is the same admin user, and the UI shows a warning banner. Use demo mode only on your own machine or a trusted local network; it has no privacy boundary between visitors.

## How environment is loaded

The control plane reads `.env` from the repo root at startup using Bun's built-in dotenv support. Variables already set in the shell environment take precedence over `.env` values. There is no hot-reload; restart the process after any change.

On a cloud VM the `.env` file is regenerated on every boot by `render-env.sh`, so hand-edits are overwritten on the next reboot. Make permanent changes in the cloud-init template instead. See [Google Cloud deployment](../deploying/gcloud.md) for details.

---

## Notes on .env.example vs config.ts

Two variables appear in `.env.example` but are not in `config.ts`'s `ControlConfig` struct because they are read outside of it:

- `PORT`: read directly by `apps/control/src/main.ts` as the listen port; also feeds the `BETTER_AUTH_URL` default in `config.ts`.
- `LOG_FORMAT`: read directly by `apps/control/src/logging.ts`; not part of `ControlConfig`.

Both are real, documented, and functional; they are just not stored in the config object.
