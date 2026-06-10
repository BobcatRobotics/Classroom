---
sidebar_position: 4
title: Security Model
---

# Security Model

This page describes how CodeRunner gates access, isolates students from each
other, and limits what a container can do. It is written for operators who need
to evaluate whether CodeRunner is safe to deploy on their network.

## Authentication

Sign-in is handled by [Better Auth](https://www.better-auth.com/) using OAuth.
GitHub and Google are the supported providers; you configure one or both by
supplying their client ID and secret as environment variables
(`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` and `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET`). If a provider's credentials are absent it is simply
not offered on the login page.

Sessions are stored in the SQLite database and tracked with a signed cookie
named `coderunner_session`. The signing key is the `BETTER_AUTH_SECRET`
environment variable. Sessions expire after 14 days; the expiry is silently
refreshed daily while the student is active.

## Email allowlist

OAuth alone is not enough to sign in. After the OAuth provider confirms a
user's identity, CodeRunner checks whether the returned email address is on the
**allowlist** (`data/allowlist.json`). The check runs in two places — on new
user creation and again on every OAuth callback — so a removed entry takes
effect at the next login attempt.

The allowlist accepts individual addresses and whole domains. A team using
`@frcteam1234.org` Google Workspace accounts can add that domain once rather
than listing every member. The file format is:

```json
{
  "emails": ["coach@example.com"],
  "domains": ["frcteam1234.org"]
}
```

An admin can manage the allowlist through the admin UI or the admin API.

## Admin role

Users have a `role` field: `student` (the default) or `admin`. Admin-only
routes require the session's role to be `admin`. An operator can also use a
static break-glass token (`ADMIN_TOKEN`) by passing it as a `Bearer` token in
the `Authorization` header — this is intended for automated tooling and
one-off operator commands, not for day-to-day use.

## Single entry point

The control plane is the only process that listens on a public port (default
`4000`, set by `PORT`). Every request — web shell assets, editor traffic, run
commands, telemetry, gamepad input — enters through that one port and is
authenticated before any proxying takes place.

Container ports are bound to `127.0.0.1` only. No container port is reachable
from outside the host, even if the host firewall is misconfigured. This means
there is no way for a student to connect to another student's container
directly from a browser.

## Per-workspace access enforcement

All workspace routes are under `/u/<slug>/...`. Before serving any request
under that prefix the control plane:

1. Resolves the session from the signed cookie.
2. Looks up the workspace record by slug.
3. Confirms that the workspace's `user_id` matches the authenticated user's ID.

A student whose session is valid but whose slug does not match the URL receives
a `403`. An unauthenticated request is redirected to the login page for browser
requests or returns `401` for API requests. There is no mechanism for a student
to reach another student's editor, simulator, or files through normal routes.

## Container isolation

Each student's container:

- Runs under the host UID/GID of the control plane process, so container files
  are owned by a non-root user.
- Has a hard memory cap enforced by Docker's cgroup limit (default `2560m`,
  set by `CODE_MEMORY_LIMIT`). A runaway robot program cannot exhaust host
  memory.
- Has its three ports bound on `127.0.0.1` only; it has no inbound network
  exposure beyond the loopback interface.

The `MAX_ACTIVE_CONTAINERS` limit (default `10`) prevents a single deployment
from spinning up more containers than the host can sustain, reducing the blast
radius of an unusually large concurrent session spike.

## Audit log

Significant actions — sign-in, workspace creation, run start/stop, project
loads, and admin operations — are written to an `audit_log` table in the
SQLite database. Each entry records the actor's user ID and email, the action,
an optional target, and a millisecond timestamp. Admins can query the log
through the admin API.

## WebSocket origin validation

Before upgrading any WebSocket connection the control plane validates the
`Origin` header against the configured `BETTER_AUTH_URL`. Cross-origin
WebSocket upgrades are rejected with `403`. Loopback aliases
(`localhost` / `127.0.0.1`) are treated as equivalent to support local
development, but production deployments served over a real hostname are not
affected by that exception.

## Demo mode

Starting the control plane with `--demo` (or `CODERUNNER_DEMO_MODE=1`) bypasses
OAuth entirely: every request is treated as a single synthetic admin session.
This is designed for zero-configuration local evaluation only.

**Demo mode must never be deployed publicly.** There is no privacy boundary
between concurrent visitors in demo mode — all requests resolve to the same
user. The control plane prints a multi-line warning banner at startup and the
workspace shell displays a yellow banner to make this visible. See
[Deploying](../deploying/overview.md) for how to configure OAuth for a real
deployment.

## What CodeRunner does not provide

Operators should be aware of the following boundaries:

- **No network egress restriction on containers.** A robot program running
  inside a container can make outbound network requests. If your environment
  requires egress filtering, that must be applied at the host or network level.
- **No code scanning.** Student code is compiled and executed as-is. CodeRunner
  does not scan or sandbox the robot program's behavior beyond the container's
  cgroup memory limit.
- **TLS termination is the operator's responsibility.** CodeRunner speaks plain
  HTTP on its single port. A reverse proxy (nginx, Caddy, or a cloud load
  balancer) must provide TLS. See [Deploying](../deploying/overview.md).
