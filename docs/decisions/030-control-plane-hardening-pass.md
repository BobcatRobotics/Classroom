# 030 — Control-Plane Hardening Pass

## Status

Accepted.

## Context

A read-only senior-advisor audit of the control plane on 2026-06-11 (against
commit `cb83908`) produced a set of self-contained improvement plans. The audit
confirmed a mature, well-tested codebase — the plans were targeted fixes, not a
rescue. They were executed in priority order on the `fable-improvements` branch
and are recorded here as a group; the per-plan handoff documents (the `plans/`
directory) were deleted once all were landed, so this decision is the durable
record of what changed and why.

Trivial items (documenting four missing `.env.example` vars, deleting a dead
`ImportManagerOptions` parameter) are intentionally omitted — they carry no
design weight. What follows are the changes worth remembering.

## Decision

### Correctness fixes

**Stale run-job status writes (`runs.ts`).** A rapid stop→start or double-start
of a simulation could let the *old* run job's terminal status overwrite the *new*
run's live status. `RunManager.finishJob` already guarded the
`jobsByWorkspace.delete` with an "am I still the current job" id check, but it
called `rememberStatus(...)` *without* that guard, so a draining old job could
stamp the workspace to `stopped`/`failed` while the new job was
`building`/`running`. The symptom was a just-started run briefly showing as
stopped, and a reconnecting Driver-Station client reading the stale snapshot. The
fix extends the same id guard to the status write.

**Capacity admission on container adoption (`local-docker-runtime-provider.ts`).**
`MAX_ACTIVE_CONTAINERS` is the host-protection cap on concurrent student
containers, but it was enforced only on the *create* path. The idle sweep stops
(without removing) containers, and reconnecting *restarts* them via `docker start`
in `adoptCodeContainer` — which ran *before* any capacity check. After a sweep, a
wave of students reconnecting at once could all adopt-and-restart past the cap and
risk host exhaustion. The restart-from-stopped path now goes through the same
admission control as create (and returns the normal capacity error when full).
Adoption of an *already-running* container is unchanged — it is already counted,
so it must not consume a new slot.

### Performance

**Batched `docker inspect` (`containers/lifecycle.ts`).**
`managedContainerStats` runs every 15s on the stats poller (and on every admin
containers-page load). It already batched `docker container ls` and `docker stats`
but then issued **one `docker inspect` subprocess per container, awaited
serially** — 30–50 serial subprocess spawns per tick at scale, with latency that
could approach or exceed the poll interval and stack ticks. `docker container
inspect` accepts multiple names and returns a JSON array, so the per-container
fan-out collapses into a single subprocess.

### Security

**Baseline response headers (`app.ts`).** The control plane set no baseline
security headers. The IDE shell, `/login`, the admin SPA, and the `/scope`
surface were served without `X-Content-Type-Options: nosniff`, `X-Frame-Options`,
or `Referrer-Policy`. Conservative, broadly-safe headers are now applied at the
single response chokepoint, guarded with `headers.has()` so they never clobber
headers the proxied openvscode editor or AdvantageScope already set. A full
`Content-Security-Policy` was deliberately left out of scope: the editor and AS
Lite rely on inline scripts / `eval`, so a real CSP needs its own separately
tested effort.

### Tech-debt / structure

**Shared `upgradeWebSocket` helper (`app/workspace-routes.ts`).** Four
near-identical WebSocket-upgrade blocks were collapsed into one helper.

**WebSocket-router characterization tests (`app/websocket.ts`).**
`createWebSocketHandlers` — the fan-out routing every WS `open`/`message`/`close`
across six socket kinds (`nt4`, `vscode`, `halsim`, `import`, `lesson-load`,
`gamepad`) — had zero direct unit coverage and was exercised only transitively
through the slow Playwright tier. Characterization tests now pin its current
behavior (kind dispatch, upstream-socket teardown on close, parse-error
handling), giving fast-tier protection and a regression net for the bridge
refactor below.

**Shared `ReconnectingWsBridge` base (`ws-bridge.ts`).** `HalSimBridge` and
`Nt4AutoChooserBridge` independently reimplemented the same connection-lifecycle
scaffolding (the `entries` map, URL-change-aware `ensureConnected`, socket wiring
with the `entry.socket !== socket` stale-guard, `disconnect`, `close`). The
duplication had already drifted — halsim grew exponential-backoff auto-reconnect
that nt4 lacked. The scaffolding moved into `ReconnectingWsBridge<W, Entry>`, with
the divergent parts as hooks (`createEntry`, `createSocket`, `onSocketOpen`,
`onSocketMessage`, `onSocketClosed`, `onSocketError`). Crucially, the reconnect
strategy is itself a hook: halsim overrides `onSocketClosed` to schedule backoff,
while nt4 leaves it poll-driven (the frontend re-calls `ensureConnected` ~1s).
Public method signatures and observable behavior are unchanged.

## Consequences

- Two latent correctness bugs (stale status overwrite, uncapped restart wave) are
  closed; both were race-conditions invisible under light load.
- The stats poller's per-tick subprocess count drops from ~N+2 to 3 regardless of
  container count, removing a scaling cliff on the 15s poll.
- Defense-in-depth headers ship now; a real CSP remains a deliberate future
  effort, not a regression.
- WebSocket lifecycle bugs are now fixed once in `ws-bridge.ts` rather than twice,
  and the previously untested router has a fast regression net. A future third WS
  bridge should `extends ReconnectingWsBridge` and implement the hooks.

The `plans/` directory was removed after all nine plans landed; their content is
superseded by this record and the per-change commit history on
`fable-improvements`.
