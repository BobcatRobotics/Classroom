# Plan: Native-feeling containerized control plane

Working branch: `dockerized-control-plane` (unmerged). This file is the working
plan + status tracker for the follow-up pass that makes the containerized
control plane feel native instead of bolted-on.

## Status

| # | Step | Status |
|---|------|--------|
| 1 | `parseBoolean("")` fix + demo mode via env passthrough (delete demo.yml) | DONE |
| 2 | `coderunner` CLI entrypoint (dispatcher) | DONE |
| 3 | `CODERUNNER_ADMIN_EMAIL` admin bootstrap | DONE |
| 4 | Self-inspection: zero-config containerized mode | DONE (+ fresh-clone fix: tracked `data/.gitkeep` so a clone owns `./data`; Docker would otherwise create it root-owned and trip the root-guard) |
| 5 | Docs sweep + decision 031 amendment | DONE |
| 6 | Full verification gates + manual docker E2E | DONE — all gates green (typecheck, 351 bun tests, 79 web tests, 55 e2e, 8 e2e:security, docs:build); manual smoke on a freshly built image verified: demo env flag, no-`.env` boot, all three values auto-detected, workspace container in network mode with PUID from stat, `coderunner` CLI via exec+run, backup, demo-off regression (empty-string env), root-guard error on root-owned data dir, `CODERUNNER_ADMIN_EMAIL` allowlist seeding, host dev loop unchanged (port mode, no auto-detection) |

Statuses: TODO → IN PROGRESS → DONE (set by the orchestrator after verifying).

---

## Context

The branch already does the hard technical work: dual-mode runtime provider
(port vs. network mode), bind-mount path translation (`containers/paths.ts`),
self-healing container adoption, a multi-stage `containers/control/Dockerfile`
that buries emsdk, CI harvesting release dists from a build stage, and compose
as the run surface. Deploy really is "pull and up".

What feels bolted-on:

1. **Demo command**: `docker compose -f docker-compose.yml -f docker-compose.demo.yml up`
   — two `-f` flags to flip one env var.
2. **Required env plumbing** in `docker-compose.yml` (`FRC_HOST_DATA_DIR`,
   `FRC_CONTAINER_NETWORK`, `FRC_CONTAINER_USER` via `CODERUNNER_WORKSPACE_UID/GID`)
   that the control plane could derive itself: it has the Docker socket and can
   `docker inspect` its own container (Mounts → host data path, Networks →
   network name) and `stat /data` for the uid:gid.
3. **Ops commands expose the implementation**:
   `docker compose exec control bun scripts/allowlist.ts add ...`.
4. **Mandatory two-step bootstrap** (allowlist add + promote after first login)
   before anyone can use a real deployment.

Decisions locked in with the user:

- **Demo mode**: env flag — `CODERUNNER_DEMO_MODE=1 docker compose up`; delete
  `docker-compose.demo.yml`.
- **Ops**: dispatching `coderunner` CLI entrypoint **and** a
  `CODERUNNER_ADMIN_EMAIL` bootstrap env.
- **Zero-config**: full self-inspection (host data dir, network, workspace
  uid:gid), with the env vars demoted to overrides.
- **Distribution**: stays git-clone. No repo-less kit, no `docker run` one-liner.
- **HARD CONSTRAINT**: the host dev loop (`bun run dev:control` + `bun run
  dev:web`, hot reload, port mode, no image rebuild) must be completely
  unchanged. Self-inspection activates only inside a container (`/.dockerenv`).

Deliberately kept as-is:

- The `workspace-template` pull-only stub service (compose pull gives parallel
  pulls + progress bars).
- Base + prod-override compose layout, selected on the VM via `COMPOSE_FILE`
  in `/opt/coderunner/.env`.
- Git-clone quick start.

Rules for all implementation steps:

- Run `bun run check:fix` before finishing any code change.
- Do **not** run `graphify update .` on this branch — the graph refresh was
  intentionally reverted (commit `befb2fe`) to keep the review diff clean.
  A single refresh happens after review.
- Do not commit; leave changes in the working tree.
- Match existing code style, comment density, and doc voice.

---

## Step 1 — `parseBoolean("")` fix + demo via env passthrough

### 1a. Bug fix (prerequisite)

`parseBoolean` (`apps/control/src/config.ts:114-125`) returns **true** for
`""` because empty string is not in the falsy list. The compose passthrough
below renders an empty string when the variable is unset, which would silently
enable demo mode. Fix: normalize first, return `fallback` for empty:

```ts
const normalized = value.trim().toLowerCase();
if (normalized === "") return fallback;
return !["0", "false", "no", "off"].includes(normalized);
```

`demo` is parsed at `apps/control/src/config.ts:309`
(`parseBoolean(input.demo ?? Bun.env.CODERUNNER_DEMO_MODE, false)`).
Add unit tests (find the existing config test file under
`apps/control/src/__tests__/`): `""` and `"  "` → fallback for both
`demo` and `containerAutoStart`; `"0"`/`"false"` still false; `"1"` still true.

### 1b. Compose + scripts + docs

- `docker-compose.yml`: add to the `control` service `environment` block:
  `CODERUNNER_DEMO_MODE: ${CODERUNNER_DEMO_MODE:-}` — compose interpolation
  reads both the caller's shell env and the project `.env`, so
  `CODERUNNER_DEMO_MODE=1 docker compose up` and a `.env` entry both work.
  Update the header comment (it lists `docker-compose.demo.yml` as an override).
- Delete `docker-compose.demo.yml`.
- `package.json`: `demo:docker` → `CODERUNNER_DEMO_MODE=1 docker compose up`.
- `docs/quick-start.md`: the run command (line ~30) becomes
  `CODERUNNER_DEMO_MODE=1 docker compose up`; adjust the surrounding prose
  ("What that command does" refers to the two-file command).
- `AGENTS.md` Commands list: "Run the containerized demo stack" entry.
- Grep the whole repo for `docker-compose.demo` and `-f docker-compose.yml -f`
  to catch stragglers (docs, deploy/, decision 031 gets rewritten in step 5).

### Verify

`bun run test` (config tests), `bun run typecheck`, `docker compose config`
renders without warnings both with and without `CODERUNNER_DEMO_MODE` set.

---

## Step 2 — `coderunner` CLI entrypoint (dispatcher)

### New file `containers/control/entrypoint.sh`

A POSIX-sh dispatcher installed at `/usr/local/bin/coderunner`:

- no args or `serve` → `bun apps/control/src/migrate.ts apply` then
  `exec bun apps/control/src/main.ts` (keep `exec` so the server is PID 1 and
  receives `docker stop`'s SIGTERM directly — same semantics as the current
  entrypoint line).
- `backup` → `exec bun scripts/backup.ts "$@"`
- `restore` → `exec bun scripts/restore.ts "$@"`
- `allowlist` → `exec bun scripts/allowlist.ts "$@"`
- `users` → `exec bun scripts/users.ts "$@"`
- `audit-prune` → `exec bun scripts/audit-prune.ts "$@"`
- `rebuild-workspaces` → `exec bun scripts/rebuild-workspaces.ts "$@"`
- `cleanup` → `exec bun scripts/cleanup-containers.ts "$@"`
- `migrate` → `exec bun apps/control/src/migrate.ts "$@"` (apply/status)
- `help` / `--help` → print a usage listing of the above.
- anything else → `exec "$@"` passthrough, so
  `docker compose run --rm control bash` and ad-hoc commands still work.

All subcommand branches must shift the subcommand off before `"$@"`.
`set -eu`. Run from `/app` (WORKDIR); scripts rely on `FRC_DATA_DIR=/data`
from the image ENV.

### Dockerfile (`containers/control/Dockerfile`)

Replace the current
`ENTRYPOINT ["/bin/sh", "-c", "bun apps/control/src/migrate.ts apply && exec bun apps/control/src/main.ts"]`
(line ~113) with:

```dockerfile
COPY containers/control/entrypoint.sh /usr/local/bin/coderunner
RUN chmod +x /usr/local/bin/coderunner
ENTRYPOINT ["coderunner"]
CMD ["serve"]
```

Note the build context is the repo root, so the COPY path is
`containers/control/entrypoint.sh`. Keep the comment explaining the
migrate-then-serve + PID 1 rationale, extended for the dispatcher.

Why both invocation styles work with one script:
- `docker compose run --rm control backup` — `run` args replace CMD, the
  entrypoint dispatches; the one-off container shares the `/data` + socket
  mounts from the service definition.
- `docker compose exec control coderunner users list` — `exec` bypasses the
  entrypoint entirely, so the shim being on PATH is what makes this form work.

### Docs

Replace every `docker compose exec control bun scripts/<name>.ts` spelling:
- `docs/deploying/local.md` steps 4–5 (allowlist + promote examples).
- `docs/operating/day-to-day.md` "Running ops commands" note (lines ~12–25).
- `docs/operating/backups.md` containerized note (lines ~30–44).
- `docs/deploying/gcloud.md`, `docs/operating/troubleshooting.md`,
  `docs/operating/seasonal-teardown.md`, `deploy/cutover-to-compose.md` — grep
  for `bun scripts/` and `exec control`.
Mention the `docker compose run --rm control <cmd>` one-off form where the
control plane may be stopped (e.g. `restore`). Keep the `bun run <name>`
aliases for from-source host checkouts.

### Verify

`bash -n containers/control/entrypoint.sh`; image build in step 6 exercises it
for real (`docker compose run --rm control help`, `... run --rm control
migrate status`, `exec control coderunner users list`).

---

## Step 3 — `CODERUNNER_ADMIN_EMAIL` admin bootstrap

Goal: a real deployment needs **zero** exec steps before first sign-in.

### Config (`apps/control/src/config.ts`)

- `ControlConfig`: add `adminEmails: string[]`.
- `ControlConfigInput`: `adminEmails?: string[] | string`.
- Parse from `Bun.env.CODERUNNER_ADMIN_EMAIL`: split on commas, trim,
  lowercase, drop empties. Unset/empty → `[]`.

### Startup seeding (`apps/control/src/main.ts`)

After the allowlist is initialized (`setAllowlistPath`/`loadAllowlist` — see
`apps/control/src/auth/allowlist.ts:50-86`; find where main/app wires it), for
each configured email:
1. `addAllowlistEntry(email)` (`allowlist.ts:119`) — check it is idempotent
   (no duplicate entries when already present); make it so if not.
2. If a `user` row with that email exists and `role != 'admin'`, promote it —
   reuse the exact UPDATE that `scripts/users.ts promote` runs (same table and
   column names; better-auth schema). Log at info:
   `bootstrap admin promoted` with the email. This covers "coach signed in as
   a student before the env was set".

### Sign-in path (`apps/control/src/auth/auth.ts:88-108`)

In the better-auth `user.create.before` hook, set
`role: adminEmails.includes(user.email.toLowerCase()) ? "admin" : "student"`.
The hook lives in `createAuth(...)` — thread `adminEmails` in the same way the
allowlist/config is already made available to that module.

### Docs + env

- `.env.example`: document `CODERUNNER_ADMIN_EMAIL` (comma-separated allowed)
  in the OAuth/Better Auth section: added to the allowlist at startup and
  granted admin on first sign-in.
- `docs/deploying/local.md`: steps 4–5 collapse into "set
  `CODERUNNER_ADMIN_EMAIL` before `docker compose up`, sign in — you're the
  admin". Keep the `coderunner allowlist`/`users` CLI forms as the alternative
  for adding students and later changes.
- `docs/deploying/oauth-credentials.md`: admin bootstrap section.
- `docs/deploying/gcloud.md` if it walks through allowlist/promote.

### Tests

- Config parsing (single email, comma list, whitespace, unset).
- Hook role assignment: existing auth/security tests under
  `apps/control/src/__tests__/` show how `createAuth` is exercised; add a case
  where a bootstrap-admin email signs up and lands with `role: "admin"`.
- Startup path: seeding adds allowlist entries idempotently and promotes an
  existing student row.

### Verify

`bun run test`, `bun run typecheck`.

---

## Step 4 — Self-inspection: zero-config containerized mode

### New module `apps/control/src/containers/self-inspect.ts`

Uses the existing docker client wrapper (`containers/docker-client.ts`) — read
it first and follow how `local-docker-runtime-provider.ts` and the tests
(`__tests__/network-mode.test.ts`, `__tests__/helpers.ts`) inject/fake it.

Behavior:

- **Activation**: only when containerized — `/.dockerenv` exists. On the host
  the module returns immediately with "not containerized" and NOTHING about
  the current behavior changes (port mode default, dev loop untouched, no new
  log lines).
- **Env always wins**: explicit `FRC_CONTAINER_NETWORK`, `FRC_HOST_DATA_DIR`,
  `FRC_CONTAINER_USER` (or `FRC_UID`+`FRC_GID`) are respected as-is;
  inspection only fills the gaps.
- `docker inspect $(os.hostname())` — compose's default hostname is the
  container ID. Parse:
  - **hostDataDir**: the `Mounts[]` entry whose `Destination` equals the
    resolved data dir (in-container this is `/data`; the image sets
    `FRC_DATA_DIR=/data`, so resolve it the same way config does) → its
    `Source`. This is *more* correct than a hand-supplied path on Docker
    Desktop/WSL2 because inspect reports the daemon-side path.
  - **network**: `NetworkSettings.Networks` keys, excluding the default
    `bridge`/`host`/`none`. Exactly one user-defined network → use it. Zero or
    several → hard error naming `FRC_CONTAINER_NETWORK`.
  - **workspace user**: `stat` the data dir → `uid:gid` of the mounted
    directory (e.g. `fs.statSync(dataDir)`). If it stats as `0:0`, do NOT
    derive — leave unset so the existing root guard fires (see below).
- **Never fall back to port mode inside a container**: port mode publishes
  loopback host ports the containerized control plane cannot reach. Every
  failure (inspect fails, no matching mount, ambiguous networks) is a hard
  startup error whose message names the env var that fixes it.

### Wiring (`apps/control/src/main.ts` + `config.ts`)

Keep `loadControlConfig` sync. In `main.ts`, before the config is loaded /
runtime provider constructed: run `selfInspect()` and merge results into the
`ControlConfigInput`. **Precedence trap**: `loadControlConfig` does
`input.X ?? Bun.env.X`, so passing inspected values as input would beat env —
wrong direction. Compute `effective = env ?? inspected` per field (or have
`selfInspect` take the env values and return finals) and pass that.

The root-user guard currently in `config.ts` (network mode + root + no
explicit user → throw, added on this branch) must still fire when the data dir
is root-owned and no `FRC_CONTAINER_USER` is set. A stat-derived non-root
uid:gid counts as a safe resolution and passes the guard; extend the guard's
error message to mention that chowning the data dir also fixes it.

Update the startup config log in `main.ts` (it already prints
`hostDataDir`/`containerNetwork`) to show which values were auto-detected,
e.g. `"(auto-detected: /home/x/coderunner/data)"`.

### Compose slimming (`docker-compose.yml`)

- Volume: `${CODERUNNER_HOST_DATA_DIR:-./data}:/data` — compose resolves `./`
  against the project directory, killing the `${PWD}` interpolation wart.
  `CODERUNNER_HOST_DATA_DIR` stays supported for relocating data.
- Drop from `environment`: `FRC_CONTAINER_NETWORK`, `FRC_HOST_DATA_DIR`,
  `FRC_CONTAINER_USER` (and the `CODERUNNER_WORKSPACE_UID/GID` interpolation).
- Keep: `CODE_IMAGE`, the `CODERUNNER_DEMO_MODE` passthrough (step 1),
  `env_file`, the explicit `coderunner` network name (must still match what
  workspaces join — self-inspection reads it from the container's own
  attachment, and the name still needs to be non-project-prefixed for
  `docker run --network`), ports, healthcheck.
- Rewrite the header comments accordingly.

### `.env.example` + deploy configs

- Remove `CODERUNNER_WORKSPACE_UID/GID`; document `FRC_CONTAINER_USER`,
  `FRC_CONTAINER_NETWORK`, `FRC_HOST_DATA_DIR` as auto-detected in
  containerized deployments, overridable for unusual setups.
- `deploy/cloud-init/user-data.yaml`: render-env.sh writes the VM `.env` —
  drop lines for the removed vars (keep `CODERUNNER_HOST_DATA_DIR`, which the
  volume mount still uses, pointing at `/var/lib/coderunner/data`); confirm
  the data dir is chowned to the app user during bootstrap so stat-derivation
  yields a non-root uid. Touch up comments.
- `deploy/cutover-to-compose.md`: references to the dropped env lines.

### Tests

New `apps/control/src/__tests__/self-inspect.test.ts` (follow the fake-docker
patterns in `network-mode.test.ts`/`helpers.ts`):
- not containerized → returns nothing, no docker calls;
- containerized happy path: mount + single network + non-root stat → all three
  derived;
- env precedence: each env var set → inspection result ignored for that field;
- error paths: no mount matching the data dir; zero user-defined networks;
  multiple networks; root-owned data dir → root-guard error message.
Also make sure existing `network-mode.test.ts` cases still pass unchanged
(they bypass inspection by passing explicit config inputs).

### Verify

`bun run test`, `bun run typecheck`; real-stack check happens in step 6.

---

## Step 5 — Docs sweep + decision 031 amendment

- Amend `docs/decisions/031-containerized-control-plane.md` (the branch is
  unmerged, so extend it in place rather than adding a new decision): demo env
  flag instead of an override file, the `coderunner` entrypoint, the
  `CODERUNNER_ADMIN_EMAIL` bootstrap, self-inspection + env-override
  precedence, and the updated Consequences (compose file is now
  image+socket+data+port; the root-ownership guard interacts with stat
  derivation).
- Sweep for stale spellings across: `docs/quick-start.md`,
  `docs/deploying/local.md`, `docs/deploying/gcloud.md`,
  `docs/deploying/oauth-credentials.md`, `docs/operating/day-to-day.md`,
  `docs/operating/backups.md`, `docs/operating/troubleshooting.md`,
  `docs/operating/seasonal-teardown.md`, `docs/reference/configuration.md`,
  `docs/reference/faq.md`, `docs/development/dev-servers.md`, `.env.example`,
  `AGENTS.md`, `deploy/README.md`, `deploy/cutover-to-compose.md`, root
  `README.md`.
  Greps that must come back clean (outside decision-log history where the old
  state is being described deliberately):
  `docker-compose.demo`, `bun scripts/` (in operator docs; dev docs may keep
  it), `CODERUNNER_WORKSPACE_UID`, `FRC_HOST_DATA_DIR` (except as documented
  override), `-f docker-compose.yml -f`.
- `bun run docs:build` must pass (broken links fail the build).

---

## Step 6 — Verification gates + manual docker E2E

Automated (repo gates, run from repo root):

```
bun run check:fix
bun run typecheck
bun run test
bun run test:web
bun run e2e
bun run e2e:security
bun run docs:build
```

Manual end-to-end (WSL2 host, Docker running):

1. `bun run docker:build:control` (warm cache expected on this machine).
2. Fresh data dir, **no `.env` at all**:
   `CODERUNNER_DEMO_MODE=1 docker compose up` → lands in the editor, lesson
   loads, Run works; files under `./data` owned by the host user
   (stat-derived), not root. `docker compose config` renders cleanly with no
   `.env` present.
3. `docker compose exec control coderunner users list` and
   `docker compose run --rm control backup` both work; backup lands under
   `./data/backups/`. `docker compose run --rm control help` prints usage.
4. Demo-off regression: plain `docker compose up` (no flag, no `.env` entry)
   must NOT boot demo mode (guards the `parseBoolean("")` fix — no demo
   banner in logs).
5. Bootstrap: `.env` with OAuth + `CODERUNNER_ADMIN_EMAIL` → sign in → admin
   panel accessible with zero exec steps (needs real OAuth creds; if
   unavailable, cover via unit tests + verify the allowlist entry appears in
   `data/allowlist.json` at startup).
6. Dev-loop regression: `bun run dev:control` + `bun run dev:web` on the host
   → port-mode values in the startup config log, workspace container starts
   with published loopback ports, hot reload works, no self-inspection log
   lines.
