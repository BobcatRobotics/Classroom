# 031 — Containerized Control Plane

## Status

Accepted.

## Context

The control plane historically ran as a **bare-metal Bun process** on the GCE
VM, supervised by systemd. Two recurring pains motivated this change:

1. **The deploy was convoluted.** A release SSHed into the VM and ran
   `git fetch`/`git checkout`, `bun install`, downloaded two prebuilt dist
   tarballs from the GitHub release, `docker pull`ed the workspace image, then
   `systemctl restart`ed the unit. Five moving parts, none of them "pull the
   new image."
2. **AdvantageScope Lite needs emsdk to build.** AS Lite compiles a wasm
   bundle, so anyone building from source needs the emscripten SDK 4.0.12 and
   the `vendor/AdvantageScope` submodule. To spare operators and demo users
   that, the project shipped prebuilt `web-dist`/`ascope-dist` tarballs on each
   release and a `setup:demo`/`fetch-dist.ts` path to download them — extra
   surface to maintain.

Containerizing the control plane collapses the deploy to "pull the newest
image" and moves the emsdk build inside `docker build`, so neither CI runners
nor operators ever install it. The development loop (`bun run dev:control` +
`bun run dev:web` on the host) is unchanged.

## Decision

### One image, built once

`containers/control/Dockerfile` is a multi-stage build (context = repo root):

- **web-build** (`oven/bun`) — `bun run build:web`.
- **ascope-build** (`emscripten/emsdk:4.0.12`, which carries node/npm/git and a
  preset `EMSDK`) — installs a pinned Bun and runs `scripts/build-ascope-lite.ts`,
  including the wasm compile. This stage needs git metadata for the
  AdvantageScope submodule, because the build resolves checked-in symlinks from
  git blobs (`git -C vendor/AdvantageScope ls-files`/`cat-file`) and applies
  patches with `git apply`. The submodule worktree's `.git` is a gitfile
  pointing at `.git/modules/vendor/AdvantageScope`, so the build copies **only
  that gitdir** (`COPY .git/modules/vendor/AdvantageScope/`), not the whole
  `.git`, to keep the layer cache stable across commits.
- **runtime** (`oven/bun`) — copies the workspace source, runs
  `bun install --frozen-lockfile --production`, then layers in the web/ascope
  dists, bundled `catalog/`, migrations, and `scripts/`. The Docker CLI is
  copied from `docker:27.5.1-cli`; the daemon is the host's, reached over the
  bind-mounted socket. Entrypoint is migrate-then-serve.

The CI publish job (`.github/workflows/deploy.yml`) builds and pushes
`ghcr.io/<owner>/coderunner-control` alongside the workspace image (distinct GHA
cache scopes), and **extracts the release tarballs from the built control image**
(`docker create` + `docker cp` of `/app/apps/web/dist` and
`/app/dist/advantagescope`). The tarballs survive for the `deploy-cloudflare`
job and for `scripts/fetch-dist.ts`, but they are a by-product of the single
image build — the runner no longer installs emsdk.

> **Why install in the runtime stage, with full source present, not a
> manifests-only deps stage.** This repo uses Bun's *isolated* linker:
> dependencies live in `node_modules/.bun/` and resolve through per-workspace
> `apps/control/node_modules/` symlinks. A manifests-only install populates the
> store but never creates those workspace links, so the runtime cannot resolve
> `@logtape`/`better-auth`/`prom-client`. Installing with the workspace source
> in place is what creates the links. (Discovered the hard way — the first build
> booted to `Cannot find module '@logtape/logtape'`.)

### Networking: a shared Docker network, not host ports

The control plane manages per-student workspace containers through the Docker
CLI. On the host it published each container's ports on `127.0.0.1` and proxied
to `localhost:<port>`. That doesn't work cleanly from inside a container, so a
**dual-mode runtime provider** was added (`apps/control/src/containers/`):

- **Port mode** (default; `FRC_CONTAINER_NETWORK` unset) — unchanged. Used by
  the host dev loop.
- **Network mode** (`FRC_CONTAINER_NETWORK=<name>`) — workspace containers join
  a shared user-defined bridge network and publish **no** host ports; the
  control plane proxies to `<container-name>:3000/5810/3300` (the fixed internal
  ports) via Docker's embedded DNS. Port leases are stored NULL (no schema
  change — the `container_leases` unique indexes are already partial on
  non-NULL). Adoption requires the container to be attached to the network and
  to publish no ports, so a leftover from the other mode is recreated rather
  than adopted (self-healing cutover).

Upstream URLs are built in one place (`converters.ts:upstreamEndpoints`, also
used by `app/websocket.ts`), branching on the mode.

### Bind-mount path translation

The control plane writes to `/data` (the host data dir bind-mounted into the
container), but `docker run --mount src=` is resolved by the daemon against the
**host** filesystem. `FRC_HOST_DATA_DIR` gives the host-side path, and
`containers/paths.ts:toHostPath` rewrites mount sources (a no-op when unset).
Persisted `workspaces.project_path` rows are re-rooted under the current
`dataDir` at startup (`storage.ts`), which also self-heals restored backups and
host↔container moves.

### docker compose is the run surface

- `docker-compose.yml` — base stack: the control service (socket + `/data`
  mounts, the `coderunner` network with an explicit name so it matches
  `docker run --network`, loopback `:4000`) plus a pull-only `workspace-image`
  stub so `docker compose pull` fetches both images.
- `docker-compose.prod.yml` — adds **Caddy** (TLS, `reverse_proxy control:4000`)
  and **Grafana Alloy** as containers. Alloy scrapes `control:4000/metrics`,
  reads host metrics through bind-mounted `/proc`/`/sys`/`/`, and ships the
  control plane's stdout logs via the Docker API (`discovery.docker` +
  `loki.source.docker`) — replacing the old journald pipeline. The control
  plane still logs NDJSON, so the `level`/`category` label extraction is
  unchanged.
- `docker-compose.demo.yml` — flips `CODERUNNER_DEMO_MODE`.

On the VM, `/opt/coderunner/.env` sets
`COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml` so a plain
`docker compose up -d` runs the prod stack. cloud-init now installs only Docker
+ the compose plugin, fetches the compose files, and renders `.env` (preserving
`CODERUNNER_TAG` across reboots) plus the Alloy config. The bare-metal
bun/systemd/host-Caddy/host-Alloy path is gone.

### Ops scripts via `docker compose exec`

Backups, allowlist/user management, audit pruning, and container rebuilds run as
`docker compose exec control bun scripts/<name>.ts` (the scripts are baked into
the image and inherit `FRC_DATA_DIR=/data`). `restore` takes a backup directory
**inside** `/data`.

## Consequences

- **Deploy is "pull and up."** `docker compose pull && docker compose up -d`,
  then recycle student containers with `rebuild-workspaces`. No checkout, no
  bun install, no tarball juggling.
- **No emsdk anywhere but the build stage.** `fetch-dist.ts`/`setup:demo`
  remain for emsdk-free host development, fed by tarballs extracted from the
  image.
- **The control container runs as root and mounts the Docker socket.** This is
  the same trust level as the prior setup (the `coderunner` host user was in the
  `docker` group), but a control-plane RCE is now container-escape-trivial. The
  socket is the only writable host mount besides `/data`. Because the control
  plane is root in-container, **network mode refuses to start without an
  explicit `FRC_CONTAINER_USER`** — otherwise workspace containers (and the
  student files they create on the host) would be root-owned.
- **First cutover on the live VM** must recreate the existing port-mode
  containers (they fail network-mode adoption and are recreated lazily;
  `rebuild-workspaces` does it eagerly). The Alloy log pipeline changes from
  journald to the Docker API — verify logs still flow after cutover (metrics
  failing is obvious; logs silently stopping is not).
- **WSL2 / Docker Desktop:** `FRC_HOST_DATA_DIR` must be the path the daemon
  sees. The dev loop is untouched.
