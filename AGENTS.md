# CodeRunner — Repo Notes for Codex

## What This Is

A browser-based IDE for learning FRC robot programming. Students write Java, click Run, and watch their robot simulate in real time with telemetry rendered by AdvantageScope Lite. Each student gets a per-student openvscode-server container with bundled redhat.java and wpilibsuite.vscode-wpilib extensions for full VS Code editor features.

Architecture and design details: [`docs/about/architecture.md`](./docs/about/architecture.md). Decision logs live in [`docs/decisions/`](./docs/decisions/).

## Stack Rule

All non-container code is **TypeScript on Bun**. Use Bun for package management, TypeScript script execution, and the control-plane runtime. Keep `tsc --noEmit`/project references for typechecking.

Inside the V2 code container, Java/Gradle/WPILib, openvscode-server, `redhat.java`, and `wpilibsuite.vscode-wpilib` are the relevant stacks.

## Repo Layout

```text
apps/control/                  Bun control plane: HTTP, WS, sessions, orchestration
apps/control/src/app.ts          slim factory + top-level fetch dispatcher
apps/control/src/app/            response/asset/proxy/status helpers + admin, workspace, websocket route groups
apps/control/src/containers.ts   barrel re-exporting the public container surface
apps/control/src/containers/     Docker client, metadata, ports, lifecycle, and the LocalDockerRuntimeProvider class
apps/control/src/metrics.ts      Prometheus registry, metric handles, route-templating helpers
apps/control/src/metrics-collector.ts  15s Docker stats poller that writes per-container gauges
apps/web/                      React + Vite browser IDE shell
packages/contracts/            Shared API schemas, message types, and path rules
containers/code/               V2 merged openvscode-server + sim container
catalog/                       Bundled (zero-config) lesson catalog: modules.json + modules/<id>/, baked into the code image
lessons-repo-root/             Staging for the standalone remote lessons repo (will move out of this repo); not used by the app build
scripts/                       TypeScript utility scripts run by Bun
patches/advantagescope/        Source-level AS Lite patches
docs/                          Site content (Docusaurus pages) + decision logs (docs/decisions/)
website/                       Docusaurus site config; docs/ is the content source
dashboards/                    Pre-built Grafana dashboard JSON files (import into Grafana Cloud)
vendor/AdvantageScope/         Pinned upstream submodule
e2e/                           Playwright E2E tests (specs/ and fixtures/)
data/                          Runtime data, gitignored
```

## Current Status

- [x] V1-0 through V1-10: V1 complete (archived)
- [x] V2-0: editor spike accepted and recorded in `docs/decisions/011-v2-editor-spike.md`
- [x] V2-1: merged code container image
- [x] V2-2: authenticated editor proxy
- [x] V2-3: orchestrator merge and run-path migration
- [x] V2-4: web shell swap to hosted openvscode editor
- [x] V2-5: file API and contracts cleanup
- [x] V2-6: lifecycle, labels, and reconciliation
- [x] V2-7: acceptance pass

V2 is complete. The system uses per-student merged containers (`coderunner-workspace`) running openvscode-server with bundled Java and WPILib extensions. The control plane proxies editor, run, and telemetry traffic through authenticated routes.

**Lessons & Modules (post-V2):** first-login template seeding is removed —
workspaces start empty and the student fills them via the topbar **Switch
Project** surface, which offers a lesson catalog plus a public GitHub team
import. The catalog has two sources behind one interface: a **bundled** `catalog/`
(zero-config, baked into the image) and a **remote** lessons repo when
`LESSONS_CATALOG_REPO` is set. Catalog loads are gitless (reset = re-load); team
imports keep `.git` for push. The per-import backup/restore flow was removed
(pure discard + git). See [`docs/lessons/overview.md`](./docs/lessons/overview.md)
and `docs/decisions/029-lessons-and-modules.md`.

**Containerized control plane (post-V2):** the control plane ships as a Docker
image (`containers/control/Dockerfile` → `ghcr.io/mathewdunne/coderunner-control`)
and is deployed with docker compose (`docker-compose.yml` base +
`docker-compose.prod.yml` for Caddy/Alloy + `docker-compose.demo.yml`). It runs
the host Docker daemon over the bind-mounted socket and manages workspace
containers as siblings. Two modes via env: **port mode** (default;
`FRC_CONTAINER_NETWORK` unset) publishes loopback ports and is what
`bun run dev:control` uses; **network mode** (`FRC_CONTAINER_NETWORK=coderunner`,
set by compose) joins a shared Docker network with no published ports and needs
`FRC_HOST_DATA_DIR` to translate bind-mount paths. The image build runs the
emsdk/AdvantageScope compile in a build stage. See
`docs/decisions/031-containerized-control-plane.md`.

## Working Principles

- Prefer boring, explicit TypeScript over clever abstractions.
- Use shared contracts before changing API shapes.
- Add or update a decision log for non-obvious architecture or tooling choices.
- Preserve student data under `data/users/<workspaceId>/project`, but note
  switching/resetting a lesson or importing a repo **intentionally discards** it
  (D4) — git is the safety net for team work, not server-side backups.
- Edit lessons in the remote lessons repo (or `catalog/` for the bundled demo);
  the bundled `catalog/` is the source of truth for the image's Gradle-cache
  priming and offline demos.
- Do not use query-param user identity in production routes.
- Do not expose per-user editor or NT4 ports directly to the browser.
- Keep AS Lite patches source-level and repeatable.
- Do not re-verify upstream extension-owned behavior unless editor or extension versions changed. Decision 011 is the evidence record.
- Keep metrics instrumentation backend-agnostic. The control plane only speaks Prometheus exposition at `/metrics`; deploy-specific shipping (Alloy → Grafana Cloud, or whatever replaces it) lives outside `apps/control/`. Decision 023 is the record.
- Run `bun run check:fix` before finalizing any code change. It applies Biome's safe lint fixes, formatting, and import organization in one pass. `bun run verify` gates on `biome ci` so unfixed issues will fail CI.
- Documentation for users and operators lives in `docs/` (the Docusaurus site); update the relevant page when changing behavior. Decision logs stay in `docs/decisions/` and are not published to the site.

## Key References

- `docs/` + `website/` — docs site content and Docusaurus config; published at `https://mathewdunne.ca/CodeRunner/`; run `bun run docs:dev` to browse locally, `bun run docs:build` to build.
- `docs/decisions/` — all architecture decision logs (011–029 active; 001–010 archived under `docs/decisions/archive/`).
- Pinned AdvantageScope submodule: `vendor/AdvantageScope` at tag `v26.0.2`.

## Commands

- Install dependencies: `bun install`
- Typecheck: `bun run typecheck`
- Lint + format + organize imports (write fixes): `bun run check:fix`
- Lint + format check only (no writes): `bun run check`
- Lint only: `bun run lint` (use `lint:fix` to apply safe fixes)
- Format only: `bun run format`
- Run Bun tests: `bun run test`
- Run frontend tests (Vitest): `bun run test:web`
- Run E2E tests (Playwright, mocked tier): `bun run e2e`
- Run E2E security tests: `bun run e2e:security`
- Build workspace image locally: `bun run docker:build:workspace`
- Build control image locally: `bun run docker:build:control`
- Pull workspace image from GHCR: `bun run docker:pull:workspace`
- Apply/check migrations: `bun run migrate`, `bun run migrate:status`
- Start control plane (dev, `--watch`): `bun run dev:control`
- Start web shell with HMR: `bun run dev:web`
- Start prod from source (migrates then serves): `bun run start`
- Run the containerized demo stack: `bun run demo:docker` (or `docker compose -f docker-compose.yml -f docker-compose.demo.yml up`)
- Prod build (web + ascope + image pull): `bun run build`
- Backup projects: `bun run backup`
- Restore projects: `bun run restore -- <backup-dir>`
- Cleanup containers: `bun run docker:cleanup`
- Browse docs locally: `bun run docs:dev`
- Build docs site: `bun run docs:build`
- Install docs dependencies: `bun run docs:install`

See `docs/deploying/` and `docs/operating/` for operator documentation.

## Testing

Three test tiers, all runnable without Docker:

- **`bun run test`** — Bun unit/integration tests for the control plane (~290 tests). Covers auth, runs, proxy, containers, the lessons catalog + load pipeline, security, reconciliation, property-based tests, and metrics route-templating cardinality.
- **`bun run test:web`** — Vitest frontend tests (~70 tests). Covers React hooks (`useSession`, `useLessons`, `useSimulationState`, `useContainerStatus`, `useAutoChoosers`, `useGamepad`, `useRunChannel`), DriverStation components, Zustand store, keyboard/gamepad mappings.
- **`bun run e2e`** — Playwright E2E mocked tier (~55 tests). Full login→editor→run→telemetry→DS flows against in-process `ControlApp` with fake openvscode-server, HALSim, and NT4 backends. No Docker required.
- **`bun run e2e:security`** — Playwright security specs (CSRF, XSS output encoding, response headers).

E2E tests use a custom Playwright fixture (`e2e/fixtures/app.ts`) that creates an isolated `ControlApp` per test with its own random port, SQLite DB, and fake upstream servers. Auth is seeded via `loginAs()` which writes user/session rows and HMAC-signs cookies.

Key E2E fixtures:
- `e2e/fixtures/fake-vscode.ts` — Fake openvscode-server (HTTP + WS upgrade)
- `e2e/fixtures/fake-halsim.ts` — Fake HALSim bridge (WS, supports stop/restart)
- `e2e/fixtures/fake-nt4.ts` — Fake NT4 server for topic announcement
- `e2e/fixtures/gamepad-shim.ts` — Playwright addInitScript gamepad override
- `e2e/fixtures/runtime.ts` — Runtime seeding helpers

The Docker smoke tier (`e2e:docker`) was intentionally not implemented — see `docs/decisions/022-skip-docker-smoke-and-import-tests.md`. The old per-import backup/restore flow is gone; import coverage now lives in control-plane tests plus the mocked E2E URL-validation spec.

See [`docs/development/testing.md`](./docs/development/testing.md) for the full test architecture and catalog.

## graphify

This project has a graphify knowledge graph at `graphify-out/`.

Rules:
- Before answering architecture or codebase questions, read `graphify-out/GRAPH_REPORT.md` for god nodes and community structure.
- If `graphify-out/wiki/index.md` exists, navigate it instead of reading raw files.
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep.
- After modifying code files in this session, run `graphify update .` to keep the graph current.
