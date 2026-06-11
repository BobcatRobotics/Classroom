---
sidebar_position: 2
title: CLI Reference
---

# CLI Reference

All scripts are run from the repo root with `bun run NAME`. They require Bun 1.3.13 or newer.

## Running the App

| Script | What it does |
|--------|-------------|
| `start` | Applies pending database migrations, then starts the control plane. The normal way to run CodeRunner in production. |
| `dev:control` | Starts the control plane with `--watch` so it restarts automatically when source files change. Use during backend development. |
| `dev:web` | Starts the Vite dev server for the React web shell with HMR. Use alongside `dev:control` during frontend development. |

## Build

| Script | What it does |
|--------|-------------|
| `build` | Full production build: builds the React web shell, builds AdvantageScope Lite assets, then pulls the workspace Docker image from GHCR. Run this before `start` on a fresh checkout. |
| `build:web` | Builds only the React web shell into `apps/web/dist`. |
| `build:ascope` | Builds only the AdvantageScope Lite assets into `dist/advantagescope`. |
| `clean` | Deletes built output directories (`apps/web/dist` and `dist/advantagescope`). Does not touch runtime data under `data/`. |

## Docs Site

| Script | What it does |
|--------|-------------|
| `docs:install` | Installs Docusaurus dependencies inside `website/`. Run once before using the docs scripts. |
| `docs:dev` | Starts the Docusaurus dev server with live reload for editing documentation. |
| `docs:build` | Builds the static docs site into `website/build/`. |

## Database

| Script | What it does |
|--------|-------------|
| `migrate` | Applies all pending database migrations. Called automatically by `start`. Run manually after pulling a new release before restarting the control plane. |
| `migrate:status` | Shows which migrations have been applied and which are pending, without making any changes. |
| `audit:prune` | Deletes audit log entries older than a given date. Usage: `bun run audit:prune --before YYYY-MM-DD [--dry-run]`. Use to keep the database from growing unbounded over a long season. |

## Docker Images and Containers

| Script | What it does |
|--------|-------------|
| `docker:pull:workspace` | Pulls `ghcr.io/mathewdunne/coderunner-workspace:latest` from the GitHub Container Registry. Called automatically by `build`. |
| `docker:build:workspace` | Builds the workspace image locally from `containers/code/Dockerfile`. Use when iterating on the container itself; normal deployments pull the prebuilt image instead. |
| `docker:push:workspace` | Builds and then pushes the workspace image to GHCR. Used by the release workflow; not needed for normal operation. |
| `docker:cleanup` | Removes all stopped managed containers (those with the `frc-sim.managed=true` label). Safe to run while the control plane is up. Accepts `--dry-run` to preview what would be removed. |
| `docker:rebuild-workspaces` | Removes all running and stopped managed V2 workspace containers and clears their database leases, forcing fresh containers on next login. Student project files are untouched; they are bind-mounted and survive container removal. Accepts `--dry-run`. Run this after updating the workspace image to force students into the new image on their next session. |

## Users and Access

| Script | What it does |
|--------|-------------|
| `allowlist:list` | Prints the current email and domain allowlist. An empty allowlist blocks all OAuth sign-ins. |
| `allowlist:add` | Adds an email address or domain to the allowlist. Usage: `bun run allowlist:add coach@example.com` or `bun run allowlist:add example.com` (domain allows all addresses at that domain). |
| `allowlist:remove` | Removes an entry from the allowlist. Usage: `bun run allowlist:remove coach@example.com`. |
| `users:list` | Lists all users in the database with their name, email, role, and workspace slug. |
| `users:promote` | Sets a user's role to `admin`. Usage: `bun run users:promote coach@example.com`. |
| `users:demote` | Sets a user's role to `student`. Usage: `bun run users:demote coach@example.com`. |

## Backup and Restore

| Script | What it does |
|--------|-------------|
| `backup` | Backs up the SQLite database, allowlist, and all student project and assets directories to a timestamped directory under `data/backups/`. Accepts `--data-dir`, `--output`, and `--projects-only` flags. Safe to run against a running instance. |
| `restore` | Restores a backup created by `backup`. Usage: `bun run restore -- <backup-dir>`. Accepts `--workspace <id>` to restore a single workspace, plus `--skip-db`, `--skip-allowlist`, `--skip-assets`, and `--dry-run`. Stop the control plane before restoring to avoid conflicts. |

## Quality and Tests

| Script | What it does |
|--------|-------------|
| `typecheck` | Runs `tsc --noEmit` across all packages. Use to catch type errors before committing. |
| `lint` | Runs Biome linting across the codebase (read-only). |
| `lint:fix` | Runs Biome linting and applies safe auto-fixes. |
| `format` | Runs Biome formatter and writes changes. |
| `check` | Runs Biome lint and format checks together (read-only, suitable for CI). |
| `check:fix` | Runs Biome lint, format, and import organization and writes all safe fixes. Run this before finalizing any code change. |
| `verify` | Full CI gate: `biome ci`, typecheck, all tests, and E2E. Must pass before merging. |
| `test` | Runs Bun unit and integration tests for the control plane and shared packages (~290 tests). No Docker required. |
| `test:web` | Runs Vitest frontend tests for the React web shell (~70 tests). No Docker required. |
| `e2e` | Runs Playwright E2E tests against an in-process mocked app (~55 tests). No Docker required. |
| `e2e:ui` | Opens the Playwright UI for interactive E2E debugging. |
| `e2e:debug` | Runs E2E tests with `PWDEBUG=1` for step-through debugging. |
| `e2e:security` | Runs Playwright security specs (CSRF, XSS, response headers). |
| `e2e:report` | Opens the last Playwright HTML report. |
