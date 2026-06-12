# Plan 001: Document the 4 missing operator env vars in `.env.example`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report — do
> not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cb83908..HEAD -- .env.example apps/control/src/config.ts`
> If either file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `cb83908`, 2026-06-11

## Why this matters

`.env.example` is the canonical discovery surface for operators configuring a
CodeRunner deployment. Four environment variables that the control plane reads
are absent from it. The most important is `METRICS_TOKEN`, which is the auth gate
for the `/metrics` Prometheus endpoint (`apps/control/src/app.ts:60-81`): when it
is unset, `/metrics` silently falls back to admin-cookie-only auth, which an
operator wiring up a scraper may not realize. `MAX_ACTIVE_CONTAINERS` is the core
capacity cap, `HALSIM_PORT_RANGE` is a loopback port range that belongs next to
the two ranges already documented, and `CODERUNNER_DEMO_MODE` toggles the
single-admin demo mode. Documenting them removes a real onboarding/operations
gap; this is a docs-only change with zero runtime risk.

## Current state

`.env.example` documents `SIM_PORT_RANGE` and `VSCODE_PORT_RANGE` but not
`HALSIM_PORT_RANGE`; documents `IDLE_*` and `ADMIN_TOKEN` but not
`MAX_ACTIVE_CONTAINERS`, `METRICS_TOKEN`, or `CODERUNNER_DEMO_MODE`.

Relevant existing section of `.env.example` (lines 45-62):

```
# ─── Code Container (merged sim + editor) ────────────────────────────
# CODE_IMAGE=coderunner-workspace             # Docker image for merged code containers
# CODE_MEMORY_LIMIT=2560m            # Memory cap per code container
# SIM_PORT_RANGE=25810-25899         # Loopback port range for sim NT4
# VSCODE_PORT_RANGE=33000-33099      # Loopback port range for openvscode-server

# ─── Run Lifecycle ───────────────────────────────────────────────────
...
# ─── Admin ───────────────────────────────────────────────────────────
# ADMIN_TOKEN=                       # Bearer token for /admin/* endpoints.
#                                    # Optional break-glass bootstrap token.
#                                    # If unset, admin routes require an admin user session.
```

The defaults and parsing live in `apps/control/src/config.ts`:

- `apps/control/src/config.ts:76` — `const defaultHalsimPortRange: PortRange = { start: 34000, end: 34099 };`
- `apps/control/src/config.ts:224-227` — reads `Bun.env.HALSIM_PORT_RANGE`, default `defaultHalsimPortRange`.
- `apps/control/src/config.ts:259-263` — reads `Bun.env.MAX_ACTIVE_CONTAINERS`, default `10`.
- `apps/control/src/config.ts:264` — reads `Bun.env.CODERUNNER_DEMO_MODE`, default `false`.
- `apps/control/src/app.ts:60-67` — reads `Bun.env.METRICS_TOKEN` (no default; empty string = fall back to admin auth).

Repo convention for `.env.example`: every line is a commented-out
`# NAME=default                  # inline description`, grouped under
`# ─── Section ───` banners, with the value being the real default.

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Typecheck | `bun run typecheck`  | exit 0, no errors   |
| Lint/format (write) | `bun run check:fix` | exit 0 |

(There is no test that asserts `.env.example` contents; verification is the
grep-based done criteria below.)

## Scope

**In scope** (the only file you should modify):
- `.env.example`

**Out of scope** (do NOT touch):
- `apps/control/src/config.ts`, `apps/control/src/app.ts` — the code already
  reads these vars correctly; this plan only documents them. Do not add new
  parsing or change defaults.
- The real `.env` file (it is gitignored and not tracked — do not create or edit it).

## Git workflow

- Branch: `advisor/001-env-example-vars`
- Single commit; message style matches repo (short imperative, e.g.
  `docs(env): document METRICS_TOKEN, MAX_ACTIVE_CONTAINERS, HALSIM_PORT_RANGE, demo mode`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `HALSIM_PORT_RANGE` to the Code Container section

In `.env.example`, immediately after the `VSCODE_PORT_RANGE` line (currently line
49), add:

```
# HALSIM_PORT_RANGE=34000-34099      # Loopback port range for the HALSim bridge
```

### Step 2: Add `MAX_ACTIVE_CONTAINERS` near the container/capacity config

Add a capacity line. Put it in the Code Container section (after the new
`HALSIM_PORT_RANGE` line is fine) or create a short `# ─── Capacity ───` banner —
match the existing banner style. Use the real default:

```
# MAX_ACTIVE_CONTAINERS=10           # Max simultaneously-running student containers
```

### Step 3: Document `METRICS_TOKEN` near the Admin/observability section

Add, with a comment that captures the fallback behavior (this is the load-bearing
detail):

```
# METRICS_TOKEN=                     # Bearer token for scraping GET /metrics.
#                                    # If unset, /metrics requires an admin session instead.
```

### Step 4: Document `CODERUNNER_DEMO_MODE`

Add (its own short banner or near the top with other mode flags — match style):

```
# CODERUNNER_DEMO_MODE=false         # Single-admin demo mode. NOT safe to expose publicly.
```

### Step 5: Format

**Verify**: `bun run check:fix` → exit 0 (Biome does not reformat `.env`-style
files, but run it to confirm nothing else regressed). Then `bun run typecheck` →
exit 0.

## Test plan

No new automated tests (this is a documentation file with no test harness).
Manual verification is the done-criteria grep below.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c 'HALSIM_PORT_RANGE' .env.example` returns `1`
- [ ] `grep -c 'MAX_ACTIVE_CONTAINERS' .env.example` returns `1`
- [ ] `grep -c 'METRICS_TOKEN' .env.example` returns `1`
- [ ] `grep -c 'CODERUNNER_DEMO_MODE' .env.example` returns `1`
- [ ] `bun run typecheck` exits 0
- [ ] `git status --porcelain` shows only `.env.example` modified
- [ ] `plans/README.md` status row for 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The default values in `apps/control/src/config.ts` no longer match those quoted
  in "Current state" (e.g. the default cap is no longer `10`, or the halsim range
  is no longer `34000-34099`) — use the live default, but flag the drift.
- `.env.example` has been substantially restructured since commit `cb83908` such
  that the section banners referenced here no longer exist.

## Maintenance notes

- When any new `Bun.env.*` var is added in `config.ts` or `app.ts`, add it to
  `.env.example` in the same change. Consider a follow-up CI check that diffs the
  set of `Bun.env.X` reads against documented keys (out of scope here).
- A reviewer should confirm the documented defaults match `config.ts` and that no
  real secret value was pasted into the example file.
