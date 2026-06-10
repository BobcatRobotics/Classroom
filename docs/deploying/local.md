---
sidebar_position: 3
title: Local Deployment
---

# Local Deployment

Everything runs on one machine — a lab PC, a spare laptop, or a mini PC — and
students connect over the local network. This is the simplest path and requires
no cloud account, domain name, or TLS certificate.

For a public URL with HTTPS, see [Google Cloud Deployment](./gcloud.md) instead.

## Prerequisites

| Requirement | Minimum | Recommended |
| --- | --- | --- |
| **Bun** | 1.3.13+ | Latest stable |
| **Docker Engine** | 24+ | Native Linux Docker |
| **Git** | 2.x | — |
| **RAM** | 16 GB (3–5 students) | 32 GB (10 students) |
| **CPU** | 4 cores | 6+ cores |
| **Disk** | 20 GB free | 50+ GB free |
| **OS** | Linux (Ubuntu 22.04+), Windows + WSL2 | Ubuntu 22.04+ native |

On Windows, use PowerShell 7 (`pwsh`) for all commands.

You also need at least one OAuth provider configured before students can sign in.
Register your GitHub or Google OAuth app first — see [OAuth Credentials](./oauth-credentials.md).

## 1. Clone and set up the repo

```bash
git clone https://github.com/mathewdunne/CodeRunner.git CodeRunner
cd CodeRunner
git submodule update --init --recursive
bun install
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
```

`BETTER_AUTH_SECRET` defaults to a hardcoded dev placeholder — always change it
in any non-demo deployment. `BETTER_AUTH_URL` defaults to
`http://localhost:4000`, which works for single-machine use but must be updated
to the LAN IP if students are on other devices (OAuth callbacks must match).

The full list of environment variables and their defaults is in `.env.example`
and in [Configuration](../reference/configuration.md).

## 3. Build the workspace image and web assets

Pull the pre-built workspace container image from GHCR:

```bash
bun run docker:pull:workspace
```

Then build the web shell and AdvantageScope Lite:

```bash
bun run build:web
bun run build:ascope
```

Or run all three together with:

```bash
bun run build
```

`bun run build` runs `build:web`, `build:ascope`, and `docker:pull:workspace` in
sequence.

## 4. Allowlist who can sign in

The allowlist controls which email addresses (or entire domains) are permitted
to complete OAuth login. **No one can sign in until at least one entry is added.**

```bash
# Allow a specific email
bun run allowlist:add coach@frcteam.org

# Or allow every address at a domain
bun run allowlist:add frcteam.org
```

Other commands: `bun run allowlist:list`, `bun run allowlist:remove`.

## 5. Start the app

```bash
bun run start
```

This runs pending database migrations first (via `bun run migrate`), then starts
the control plane on port 4000. Students open `http://<your-LAN-IP>:4000/` in
their browsers.

To verify the app is up:

```bash
curl http://localhost:4000/healthz
```

## 6. Promote the first admin

The first time a coach signs in via OAuth, their account is created as a regular
user. After signing in once, promote them to admin:

```bash
bun run users:promote coach@frcteam.org
```

Admins can manage workspaces, adjust the container cap, and view the audit log
from the admin panel. See [OAuth Credentials](./oauth-credentials.md) for more
on the allowlist and admin bootstrap flow.

Other user commands: `bun run users:list`, `bun run users:demote`.

## Stopping and restarting

Press `Ctrl+C` to stop the control plane. Student containers keep running and
are reconciled on the next `bun run start`. To stop containers too:

```bash
bun run docker:cleanup
```

## A note on plain HTTP

The local deployment serves over plain HTTP. Keep the machine on a **trusted
network** (your team's LAN or a hotspot you control). If students need to reach
the app from outside your local network, use the
[Google Cloud Deployment](./gcloud.md) instead, which puts Caddy in front for
automatic HTTPS.
