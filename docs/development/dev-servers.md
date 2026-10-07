---
sidebar_position: 1
title: Development Servers
---

# Development Servers

This page covers the day-to-day inner loop for working on CodeRunner: getting the
repo running locally, the two dev servers, and the gates to run before you call a
change done. If you just want to stand up the whole app, start with the
[Quick Start (Installation)](../quick-start.md). For the big picture of how the pieces fit, see
the [architecture overview](../about/architecture.md).

## First-time setup

CodeRunner is TypeScript on [Bun](https://bun.sh). All non-container code uses Bun
for package management, script execution, and the control-plane runtime.

```bash
bun install
git submodule update --init --recursive
```

The submodule step pulls the pinned `vendor/AdvantageScope` checkout, which the
telemetry build (`bun run build:ascope`) depends on. If you don't want to build
AdvantageScope from source (it needs emscripten), run `bun run setup:demo` (or
`bun run fetch:dist`) to download the prebuilt web shell, AdvantageScope, and
PathPlanner assets into their local dist directories. PathPlanner is only ever
downloaded — it is built by the separate `pathplanner-web` fork, so there is no
local build. `fetch:dist` treats it as optional (a missing artifact leaves
`/pathplanner/` serving a 503), while `bun run build` fetches it via
`bun run fetch:pathplanner` and fails if it is unavailable.

:::note[Dev runs use published host ports, not a Docker network]

The dev loop runs the control plane as a host Bun process, which reaches each
workspace container over a loopback port (`FRC_CONTAINER_NETWORK` unset). This is
unchanged from before containerization — the shared-network mode is only used
when the control plane *itself* runs in a container (see
[decision 031](https://github.com/mathewdunne/CodeRunner/blob/main/docs/decisions/031-containerized-control-plane.md)).
A host process can't resolve container DNS names, so don't set
`FRC_CONTAINER_NETWORK` for `bun run dev:control`.

:::

:::note[Windows]

On Windows the AdvantageScope step may appear to hang the first time (it stalls
while bundling/minifying the large `hub.js` renderer, often for a minute or two).
If it seems stuck, cancel and re-run the build. The second run usually proceeds
quickly. Building under WSL avoids the slowdown entirely.

:::

## Repo layout

A one-line map of the top-level directories you'll touch most:

- `apps/control/`: Bun control plane (HTTP, WebSocket, sessions, container orchestration, proxies, and tool assets).
- `apps/web/`: React + Vite browser IDE shell.
- `packages/contracts/`: shared API schemas, message types, and path rules consumed by both sides.
- `containers/code/`: the merged VSCodium + simulator Docker image (see [Workspace Image](./workspace-image.md)).
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

### Local CodeRunner prototype: `bun run --cwd apps/launcher dev:local`

This starts the existing control plane and complete web shell against local
Docker, using demo authentication and a separate `data/local-phase2` directory.
It binds the control-plane UI/API to `127.0.0.1` and is intended only for the
Phase 2 local-shell prototype. It is not the paired student launcher: demo mode
bypasses authentication, central account linking is not implemented, and the
workspace image still needs Docker Desktop. Do not expose this process to a LAN
or the internet.

Start it on an unused port and open the local workspace:

```bash
PORT=4010 bun run --cwd apps/launcher dev:local
```

Then open `http://127.0.0.1:4010/u/demo/`. The wrapper pins the workspace image
by digest; set `FRC_LOCAL_CODE_IMAGE` to a different image reference only when
intentionally testing another build or release. The local workspace memory cap
defaults to `4096m` to accommodate the editor, Gradle, and simulation together;
`FRC_LOCAL_CODE_MEMORY_LIMIT` overrides it for resource testing.

The prototype uses the repository's built web, AdvantageScope, and PathPlanner
assets. Run `bun run build:web` if the React shell has changed; the other assets
are prepared by `bun run fetch:dist` or the normal build steps.

#### Guided local runtime

The source-checkout launcher prototype provides setup, start, repair, and
diagnostics commands without requiring students to type Docker commands:

```bash
bun run --cwd apps/launcher local:setup       # check Docker Desktop, prepare storage, pull the pinned image
bun run --cwd apps/launcher local:start       # set up if needed, start CodeRunner, wait for workspace readiness
bun run --cwd apps/launcher local:diagnostics # print a support report without project data or credentials
```

Use **CodeRunner > Repair runtime** in the desktop app to repeat setup after
correcting a problem.

Setup supports macOS on Apple silicon or Intel, and Windows x64. Docker Desktop
must be installed and running with its Linux container engine. Workspace project
files live below the per-user CodeRunner data directory; editor/config state is
kept separately in a Docker volume. The workspace image is pinned by digest.
Docker image pulls report completed and active layer counts rather than showing
each changing Docker status as if it were overall download progress. Docker
errors identify whether Docker Desktop is missing, stopped, or unable to pull
the image; Diagnostics includes the CodeRunner version and detailed startup
output. Errors for permissions and low Docker disk space include a recovery
action. If
startup exceeds ten minutes, the service remains running so the student can
inspect its output or collect diagnostics, then reopen the page at
`http://127.0.0.1:<port>/u/demo/`.

The launcher prefers port 4000 and chooses the next available loopback port if
that port is busy. It searches up to 100 ports and reports an actionable error
if none are available.

Closing the terminal running `local:start` stops the local control service but
leaves the workspace container and its data in place. Starting again adopts the
existing container; normal container and simulator controls remain available in
the shell. This prototype does not install Docker Desktop or bypass device
permissions; students who cannot install or start it need an approved school or
family support path.

#### Packaged desktop sign-in

Packaged Electron launches authorize with central CodeRunner before starting the
local runtime. The launcher opens the central site in the system browser and
uses GitHub sign-in; an existing central browser session may avoid asking for
GitHub credentials again. After the first sign-in, the launcher caches the
opaque launch grant using Electron's OS-backed secure storage and revalidates it
online each time the app starts. The default grant lifetime is one hour; set
`CODERUNNER_DESKTOP_LAUNCH_GRANT_TTL_MS` on the central control plane to change
it (one minute to 24 hours). Expiration, account disablement, or revocation
requires central sign-in again.
The central GitHub OAuth callback remains unchanged. CodeRunner sends a
short-lived PKCE-protected, single-use handoff through a loopback callback.
The resulting launch grant may be reused until it expires, but can be revoked
centrally. The central user profile and role populate a device-local session;
admins remain admins, students remain students. The local session uses the
existing device-local workspace identity and never stores a central workspace
ID with the project.

The packaged app defaults to `https://coderunner.wiredcats5885.ca`. Developers
can override the central origin with `CODERUNNER_CENTRAL_URL` for staging or a
local control-plane deployment. Source-checkout `dev:local` remains a demo-mode
prototype and does not perform central sign-in.

The packaged app reads these values when it launches; `desktop:build` does not
embed shell environment variables, and the app does not load the repository's
`.env`. To test with a local central server, launch the app with
`CODERUNNER_CENTRAL_URL=http://localhost:4000`. To deliberately bypass central
sign-in for a local demo, launch with `CODERUNNER_DEMO_MODE=1`; this enables the
local Demo admin session and should not be used for normal student testing.

#### Desktop package builds

The Electron launcher packages a web shell and local runtime built from the
current checkout. The build inputs are:

- `apps/launcher/package.json`, `main.cjs`, and `electron-builder.yml` for
	the app version, desktop process, installer targets, and OS packaging settings.
- `apps/launcher/scripts/local-runtime.ts`, bundled with its imported
	`runtime/` and `apps/control` modules, plus the Bun executable copied from the
	build host. The packaged app does not need Bun installed separately.
- The `apps/web` production build, AdvantageScope and PathPlanner distributions,
	bundled catalog, and control-plane migrations, staged under the app's runtime
	resources. AdvantageScope is built from the checked-out submodule through the
	control image's Emscripten build stage; `ASCOPE_RELEASE_TAG` pins and validates
	that source version. PathPlanner is downloaded by `desktop:prepare` and can be
	pinned with `PATHPLANNER_RELEASE_TAG`.
- The workspace image pinned by digest in `apps/launcher/runtime/local-setup.ts`.
	It is pulled at runtime rather than embedded in the installer.

Run `bun run --cwd apps/launcher desktop:prepare` to build and stage these
inputs, `bun run --cwd apps/launcher desktop:build` to produce an unsigned
package for the current host, or `bun run --cwd apps/launcher desktop:release`
to build a signed release. Launcher metadata, staged resources, and installer
artifacts are kept under `apps/launcher/`; installers are written to
`apps/launcher/dist/installers/`. Supported build hosts are macOS arm64/x64 and
Windows x64. macOS builds produce ZIP and DMG files; Windows builds produce an
NSIS installer. `desktop:build` targets only the current host OS and
architecture; it does not build a cross-platform matrix. Produce the three
supported variants on matching build hosts:

| Build host | Package target | Install artifacts |
| --- | --- | --- |
| macOS Apple silicon | macOS arm64 | ZIP and DMG |
| macOS Intel | macOS x64 | ZIP and DMG |
| Windows x64 | Windows x64 | NSIS EXE |

That is three target variants and five install artifacts. Windows ARM64 is not
currently supported. The focused local setup/recovery tests run with
bun test apps/launcher/runtime/local-setup.test.ts`.

The launcher has its own package metadata and version, separate from the
workspace root and web package. The launcher, bundled runtime, web shell, and
staged assets are still built together from one checkout. The workspace image
has its own immutable digest, but
the local API compatibility requirement is currently represented by the pinned
image/runtime pairing in that checkout, not by runtime protocol negotiation.
When changing local runtime APIs or the image, validate the pairing and update
the pin as one tested change. Central control-plane deployments do not update
the local app or its workspace image.

Use `bun run --cwd apps/launcher desktop:release` for a signed release. It requires `CSC_LINK` and
`CSC_KEY_PASSWORD`; macOS additionally requires `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` for notarization. Supply
these only through the release environment or secret store, never source files.
The Windows NSIS uninstall configuration preserves per-user app data; removing
the macOS app bundle likewise does not remove its Application Support data.
Project deletion remains a separate explicit action and is not part of
uninstall or runtime repair.

Uninstall the Windows app through Windows Settings or its Start menu uninstaller.
On macOS, quit CodeRunner and move the app from Applications to Trash. Both
operations remove the desktop app but intentionally preserve the project,
editor/config state, and Docker workspace resources. The launcher does not
currently stop or remove the Docker workspace during uninstall, so the
workspace container may continue running. There is no packaged full-cleanup
flow; do not ask pilot students to run Docker commands to remove it.

#### Local workflow parity

| Hosted workflow | Local implementation | Validation / remaining work |
| --- | --- | --- |
| Edit files in VSCodium | Existing editor proxy and project bind mount | A file created and edited in the browser editor was present in the host project; confirmed replacement removed it. |
| Build/run robot code and read logs | Existing run manager and workspace runtime APIs | Run path passed on the Mac prototype; WPILib editor-build evidence and Windows remain open. |
| Driver Station and simulation | Existing HALSim controls and NT4 connection | Enable/disable passed; live AdvantageScope rendering still needs checking. |
| AdvantageScope telemetry | Local NT4 endpoint through the shell | Robot sim and NT4 clients connected; rendered telemetry is blocked by the first-run beta acknowledgement, which requires user consent. |
| PathPlanner file access | Existing local proxy and project file APIs | Pane startup read the project snapshot and wrote `navgrid.json`; confirmed on the host mount before project replacement. Direct path editing remains unverified. |
| Project Preview | Existing local Preview routes and pane | Pane/routes loaded; rendered project content remains part of acceptance testing. |
| Switch project | Existing lesson/import selector and project APIs | Verified discard warning, Back preserving the host marker, and Continue replacing files on disk. |
| Sign-in, lessons, assignments, progress, submissions | Not supplied by demo-mode local shell | Deliberately remains central-account/device-linking work in Phase 3. |

The local shell is the student experience for this prototype; opening the
workspace editor directly does not provide the workflows above.

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
Vite proxies API, health, metrics, AdvantageScope, PathPlanner, admin, and
per-user (`/u/<id>/…`) traffic, including WebSocket upgrades, to the control
plane at `http://localhost:4000`. The proxy config lives in `apps/web/vite.config.ts`, so
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
