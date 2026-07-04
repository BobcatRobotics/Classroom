---
sidebar_position: 3
title: Local Deployment
---

# Local Deployment

Everything runs on one machine (a lab PC, a spare laptop, or a mini PC) and
students connect over the local network. This is the simplest path and requires
no cloud account, domain name, or TLS certificate.

For a public URL with HTTPS, see [Google Cloud Deployment](./gcloud.md) instead.

The control plane, Caddy, and the per-student workspaces all run as containers,
so the only thing you install on the host is **Docker with the Compose plugin**.
You no longer need Bun, the AdvantageScope submodule, or emscripten for a
self-hosted deployment — the published `coderunner-control` image already
contains the web shell and AdvantageScope Lite assets.

## Prerequisites

| Requirement | Minimum | Recommended |
| --- | --- | --- |
| **Docker Engine + Compose plugin** | 24+ | Native Linux Docker |
| **Git** | 2.x | n/a |
| **RAM** | 16 GB (3–5 students) | 32 GB (10 students) |
| **CPU** | 4 cores | 6+ cores |
| **Disk** | 20 GB free | 50+ GB free |
| **OS** | Linux (Ubuntu 22.04+), Windows + WSL2 | Ubuntu 22.04+ native |

You also need at least one OAuth provider configured before students can sign in.
Register your GitHub or Google OAuth app first; see [OAuth Credentials](./oauth-credentials.md).

## 1. Clone the repo

You only need the compose files and `.env.example`; no submodules or `bun install`.

```bash
git clone https://github.com/mathewdunne/CodeRunner.git CodeRunner
cd CodeRunner
```

## 2. Create your `.env` file

Copy the example and fill in the required values:

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```bash
# Generate a random secret: openssl rand -hex 32
BETTER_AUTH_SECRET=<random-string>

# Set to the address students will use. For LAN use, this is the machine's IP.
# If your machine's LAN IP is 192.168.1.50, use:
BETTER_AUTH_URL=http://192.168.1.50:4000

# At least one OAuth provider is required. Fill in both if you want both.
GITHUB_CLIENT_ID=<your-github-client-id>
GITHUB_CLIENT_SECRET=<your-github-client-secret>
# GOOGLE_CLIENT_ID=<your-google-client-id>
# GOOGLE_CLIENT_SECRET=<your-google-client-secret>

# Your email(s) — bootstraps admin access with zero exec steps. Comma-separated.
# Each is added to the allowlist at startup and made an admin on first sign-in.
CODERUNNER_ADMIN_EMAIL=you@yourteam.org
```

`BETTER_AUTH_SECRET` defaults to a hardcoded dev placeholder; always change it
in any non-demo deployment. `BETTER_AUTH_URL` defaults to
`http://localhost:4000`, which works for single-machine use but must be updated
to the LAN IP if students are on other devices (OAuth callbacks must match).

Student data (the SQLite DB and per-workspace projects) defaults to `./data` in
the checkout — no env var needed for a single-machine setup. Set
`CODERUNNER_HOST_DATA_DIR` to an **absolute** host path only if you want to
relocate it, for example onto a larger or separate disk. The control plane
figures out the corresponding in-container mapping itself by inspecting its
own container at startup, so you don't need to keep the two paths in sync by
hand.

The full list of environment variables and their defaults is in `.env.example`.

## 3. Start the app

```bash
docker compose up -d
```

This pulls the `coderunner-control` and `coderunner-workspace` images from GHCR,
creates the `coderunner` Docker network, runs database migrations, and starts the
control plane on port 4000. The first pull is several gigabytes (the workspace
image carries the Java/WPILib toolchain), so it takes a while; later starts reuse
the cache.

To verify the app is up:

```bash
curl http://localhost:4000/healthz
docker compose ps          # control should be "healthy"
```

Students open `http://<your-LAN-IP>:4000/` in their browsers.

To pull a newer release later, set `CODERUNNER_TAG` in `.env` (or leave it at
`latest`) and run `docker compose pull && docker compose up -d`.

## 4. Sign in as the first admin

If you set `CODERUNNER_ADMIN_EMAIL` in `.env` before `docker compose up`, there
are **no exec steps to reach the admin panel**. On startup the control plane
adds each listed email to the allowlist and, on first OAuth sign-in, creates the
account with the admin role (an account that already exists is promoted at the
next startup). Just open the app, sign in with that email, and you land as an
admin who can manage workspaces, adjust the container cap, and view the audit
log.

If you would rather bootstrap by hand — or you need to add students and make
later changes — the ops commands run inside the control container via the
`coderunner` CLI, either with `docker compose exec` (control plane already up)
or `docker compose run --rm control <subcommand>` (works even while it's
stopped).

The allowlist controls which email addresses (or entire domains) may complete
OAuth login. **No one can sign in until they match an allowlist entry** (the
`CODERUNNER_ADMIN_EMAIL` accounts are added automatically):

```bash
# Allow a specific student email
docker compose exec control coderunner allowlist add student@frcteam.org

# Or allow every address at a domain
docker compose exec control coderunner allowlist add frcteam.org
```

Other allowlist commands: `... coderunner allowlist list`,
`... coderunner allowlist remove`.

To promote another coach to admin after they have signed in once:

```bash
docker compose exec control coderunner users promote coach@frcteam.org
```

Other user commands: `... coderunner users list`, `... coderunner users demote`.
See [OAuth Credentials](./oauth-credentials.md) for more on the allowlist and
admin bootstrap flow.

## Stopping and restarting

```bash
docker compose stop      # stop the control plane (student containers keep running)
docker compose up -d     # start again; existing student containers are reconciled
docker compose down      # stop and remove the control container + network
```

Student containers are managed by the control plane (not compose), so they
survive `docker compose stop`. To force them all to recreate (for example
after a workspace-image update), recycle them with
`docker compose exec control coderunner rebuild-workspaces` while the control
plane is up, or `bun run docker:rebuild-workspaces` from a from-source
checkout. To just remove already-stopped ones without forcing a recreate, use
`coderunner cleanup` / `bun run docker:cleanup` instead.

## A note on plain HTTP

The local deployment serves over plain HTTP. Keep the machine on a **trusted
network** (your team's LAN or a hotspot you control). If students need to reach
the app from outside your local network, use the
[Google Cloud Deployment](./gcloud.md) instead, which puts Caddy in front for
automatic HTTPS.
