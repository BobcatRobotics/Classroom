# Plan 008: Characterization tests for the WebSocket message router

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report — do
> not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cb83908..HEAD -- apps/control/src/app/websocket.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (adds tests only; no production code changes)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `cb83908`, 2026-06-11

## Why this matters

`createWebSocketHandlers` (`apps/control/src/app/websocket.ts`, 397 lines) is the
fan-out that routes every WebSocket `open`/`message`/`close` across six socket
kinds (`nt4`, `vscode`, `halsim`, `import`, `lesson-load`, `gamepad`). It proxies
upstream sockets, parses and runs imports/lesson-loads, dispatches run start/stop,
and tears everything down on close. Today it has **zero** direct unit coverage —
`grep` for `createWebSocketHandlers` / `app/websocket` across the test suites
returns nothing; it is exercised only transitively through the slow Playwright
e2e tier. A regression in a branch (a missing `kind` case, an upstream socket
leaked on close, a swallowed parse error) escapes the fast tiers. This plan adds
characterization tests that pin the current behavior, giving plan 009 (the
shared-bridge refactor that touches the bridges this router drives) a fast
regression net. **No production behavior changes — tests only.**

## Current state

`apps/control/src/app/websocket.ts` exports `createWebSocketHandlers(ctx)` which
returns `{ open, message, close }`. The handlers branch on `ws.data.kind`.

The wired handler object is reachable in tests as `app.websocket` on a `ControlApp`
built by the `withApp` helper (`apps/control/src/app.ts:358-366` wires
`createWebSocketHandlers` and exposes it as `ControlApp.websocket`).

The socket shape the handlers expect (`apps/control/src/app/types.ts:120-125`):

```ts
export type AppSocket = {
	data: SocketData;
	send(data: string): unknown;
	send(data: ArrayBuffer | Uint8Array): unknown;
	close(code?: number, reason?: string): unknown;
};
```

`SocketData` is a discriminated union on `kind`
(`apps/control/src/app/types.ts:56-118`): `RunSocketData`, `Nt4SocketData`,
`VscodeSocketData`, `HalSimSocketData`, `ImportSocketData`, `LessonLoadSocketData`,
`GamepadSocketData`. The proxy kinds (`nt4`/`vscode`/`halsim`) carry
`upstreamUrl`, `protocols`, `upstream?`, `upstreamOpen`, `pendingMessages`.

Key, **directly testable** behaviors (no real upstream socket needed):

- **`open` / gamepad**: sends `{ type: "hello" }` (`websocket.ts:166-169`).
- **`open` / import|lesson-load**: no-op (waits for a request message) (`:162-165`).
- **`open` / run**: calls `runs.connect(workspace, cb)` and stores the connection
  (`:170-172`).
- **`message` / gamepad**: parses `gamepadClientMessageSchema`; on success calls
  `gamepad.handleMessage(...)`; on `"no-lease"` sends `{type:"error", message:"Simulator is not running."}`;
  on `"halsim-unavailable"` sends `{type:"halsim-disconnected"}`; on parse failure
  sends `{type:"error", message:<detail>}` (`:192-224`).
- **`message` / import**: parses `importRequestSchema` + `parseGitHubUrl`; on
  `RateLimitError` sends an error and closes; on other parse error sends error +
  closes (`:226-282`).
- **`message` / lesson-load**: parses `lessonLoadRequestSchema`; on error sends
  error and closes 1000 (`:284-335`).
- **`message` / run**: parses `runClientMessageSchema`; `"start"` →
  `halsim.disconnect` + `nt4Auto.disconnect` + `runs.start` + sends `{type:"hello",runId}`;
  `"stop"` → disconnects + `runs.stopWorkspace`; bad json → sends error (`:337-365`).
- **`message` / proxy (nt4/vscode/halsim)**: if `upstreamOpen && upstream` forwards
  via `sendUpstreamWebSocketMessage`; else buffers into `pendingMessages`, and once
  `pendingMessages.length >= PROXY_PENDING_LIMIT` (256, `types.ts:65`) closes the
  socket with code 1013 (`:174-190`). Testable by setting `data.upstream` to a fake
  object with a `send` spy and `data.upstreamOpen = true/false` — no real socket.
- **`close` / proxy**: `ws.data.upstream?.close()` and `pendingMessages.length = 0`
  (`:372-380`). Testable with a fake `upstream` (a `close` spy) and a non-empty
  `pendingMessages`.
- **`close` / gamepad**: `gamepad.closeSession(...)` (`:387-390`).
- **`close` / run**: `runs.disconnect(connection)` if present (`:392-394`).

The **`open` handler for proxy kinds** constructs a real `new WebSocket(upstreamUrl)`
(`openProxyUpstream`, `:67-142`) using the global constructor (not injected). Do
**NOT** try to unit-test that path here — it needs a real fake upstream server
(the e2e fixtures already cover it). Cover proxy `message` and `close` only.

Existing test patterns to reuse:
- `withApp(async (app, root) => { ... })` — builds a wired `ControlApp`
  (`helpers.ts:153`). `app.websocket`, `app.runs`, `app.halsim`, `app.nt4Auto`,
  `app.gamepad`, `app.imports` are all available.
- `login(app, "Alice")` then `workspaceBySlug(app, "alice")` →
  a `WorkspaceRow` to use as `data.workspace` (`helpers.ts:689`, `:776`).
- `apps/control/src/__tests__/gamepad.test.ts:6-30` — a `FakeWebSocket` class
  pattern (spies on `send`/`close`) you can adapt for the fake `AppSocket` and the
  fake `upstream`.

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
|-----------|----------------------------------------------------------|---------------------|
| Typecheck | `bun run typecheck`                                      | exit 0, no errors   |
| New test  | `bun test apps/control/src/__tests__/websocket-router.test.ts` | all pass     |
| Control tests | `bun run test`                                       | all pass            |
| Lint/format (write) | `bun run check:fix`                            | exit 0              |

## Scope

**In scope** (the only file you should create):
- `apps/control/src/__tests__/websocket-router.test.ts` (new)

**Out of scope** (do NOT modify):
- `apps/control/src/app/websocket.ts` — **no production changes**. This plan only
  observes current behavior. If a test reveals what looks like a bug, write the
  test to assert the **current** behavior and note the suspected bug in a comment;
  do not "fix" it here.
- The proxy `open` path (real upstream WebSocket) — out of scope (e2e covers it).
- Any helper file — add the fake-socket helper inside the new test file.

## Git workflow

- Branch: `advisor/008-ws-router-tests`
- Single commit; message e.g. `test(ws): characterization tests for the websocket message router`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Scaffold the test file and a fake-socket factory

Create `apps/control/src/__tests__/websocket-router.test.ts`. Add a helper that
builds a fake `AppSocket` capturing sent messages and close calls:

```ts
import { describe, expect, test } from "bun:test";
import type { AppSocket, SocketData } from "../app/types";
import { login, withApp, workspaceBySlug } from "./helpers";

function fakeSocket(data: SocketData): AppSocket & {
	sent: Array<string | ArrayBuffer | Uint8Array>;
	closes: Array<{ code?: number; reason?: string }>;
} {
	const sent: Array<string | ArrayBuffer | Uint8Array> = [];
	const closes: Array<{ code?: number; reason?: string }> = [];
	return {
		data,
		send(payload: string | ArrayBuffer | Uint8Array) {
			sent.push(payload);
		},
		close(code?: number, reason?: string) {
			closes.push({ code, reason });
		},
		sent,
		closes,
	};
}
```

(Confirm the exact exported names `AppSocket` / `SocketData` in
`apps/control/src/app/types.ts` and import accordingly.)

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Cover the `open` handler per kind

Inside a `withApp` block, after `await login(app, "Alice")` and
`const workspace = workspaceBySlug(app, "alice")`, drive `app.websocket.open(...)`:

- **gamepad**: `open` a `fakeSocket({ kind: "gamepad", workspace })`; assert
  `sent[0]` parses to `{ type: "hello" }`.
- **import / lesson-load**: `open` is a no-op; assert nothing is sent and the
  socket is not closed.
- **run**: `open` a `fakeSocket({ kind: "run", workspace })`; assert
  `ws.data.connection` is now set (the run connection was registered).

### Step 3: Cover the `message` handler error/dispatch paths

- **gamepad bad json**: `message(ws, "not json")` → assert a `{type:"error"}` is
  sent (parse failure path).
- **run start**: send `JSON.stringify({ type: "start" })` on a `run` socket whose
  `data.connection` was set in Step 2; assert a `{ type: "hello", runId }` is sent
  and `app.runs.getWorkspaceSnapshot(workspace.id)` (or the equivalent accessor the
  existing run tests use) reflects a started run. (Read `runs.test.ts` for the
  accessor.)
- **run bad json**: send `"{"` → assert `{type:"error"}` sent.
- **import bad request**: on an `import` socket, send `JSON.stringify({ url: "not-a-github-url" })`;
  assert an error message is sent and the socket is closed (a `closes` entry
  appears).
- **lesson-load bad request**: on a `lesson-load` socket, send invalid JSON or an
  unknown moduleId; assert an error is sent and the socket closes 1000. (This path
  is async — `void (async () => { ... })()`. Use the `waitFor` helper from
  `helpers.ts` to await the `sent`/`closes` side effect rather than asserting
  synchronously.)

### Step 4: Cover proxy `message` buffering/limit and `close` teardown

These don't need a real upstream — set `data` fields directly:

- **buffer when upstream not open**: build `fakeSocket({ kind: "nt4", upstreamUrl:
  "ws://127.0.0.1:1/x", protocols: [], upstream: undefined, upstreamOpen: false,
  pendingMessages: [] })`; call `message(ws, "hello")`; assert
  `ws.data.pendingMessages.length === 1`.
- **forward when upstream open**: set `upstreamOpen: true` and `upstream` to a fake
  object `{ send(spy), readyState: WebSocket.OPEN, close() }`; call `message`;
  assert the fake upstream's `send` spy received the payload and `pendingMessages`
  stayed empty. (Check how `sendUpstreamWebSocketMessage` calls the upstream so the
  fake matches its expectations — read `apps/control/src/app/proxy.ts`.)
- **pending limit closes 1013**: with `upstreamOpen: false`, push
  `PROXY_PENDING_LIMIT` (256) messages, then one more; assert the socket was closed
  with code `1013`.
- **close teardown**: build a proxy socket with a fake `upstream` (a `close` spy)
  and a non-empty `pendingMessages`; call `close(ws)`; assert the upstream `close`
  spy was called and `pendingMessages.length === 0`.

### Step 5: Cover `close` for gamepad and run

- **gamepad close**: `close` a gamepad socket → assert no throw (and, if observable,
  that `gamepad.closeSession` ran — at minimum assert it doesn't throw and doesn't
  send).
- **run close**: with a run socket whose `connection` is set, `close(ws)` → assert
  no throw (the connection is disconnected).

### Step 6: Format and full run

**Verify**:
- `bun test apps/control/src/__tests__/websocket-router.test.ts` → all pass
- `bun run test` → all pass
- `bun run check:fix` → exit 0

## Test plan

This plan *is* the test plan. The new file
`apps/control/src/__tests__/websocket-router.test.ts` characterizes the router as
described in Steps 2-5. Use `bun:test` (`describe`/`test`/`expect`) like the other
files in `apps/control/src/__tests__/`. Model fakes on
`gamepad.test.ts`'s `FakeWebSocket`. Use `withApp` for wiring and `waitFor` for the
async import/lesson-load assertions.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `apps/control/src/__tests__/websocket-router.test.ts` exists
- [ ] `bun test apps/control/src/__tests__/websocket-router.test.ts` passes with tests covering: gamepad open `hello`, gamepad bad-json error, run start dispatch, run bad-json error, import bad-request close, lesson-load bad-request close, proxy buffer-when-closed, proxy forward-when-open, proxy pending-limit 1013, proxy close teardown
- [ ] `bun run typecheck` exits 0
- [ ] `bun run test` exits 0
- [ ] `git diff --name-only` shows ONLY the new test file added (no production file changed)
- [ ] `plans/README.md` status row for 008 updated

## STOP conditions

Stop and report back (do not improvise) if:

- A test can only pass by changing `apps/control/src/app/websocket.ts` — that is
  out of scope; the tests must characterize current behavior, not fix it.
- The async import/lesson-load paths can't be observed deterministically even with
  `waitFor` — report; we may need a small seam, which is a maintainer decision.
- `sendUpstreamWebSocketMessage` requires a real `WebSocket` instance (not a duck-
  typed fake) — report; the proxy-forward test may need a different fake shape.

## Maintenance notes

- These are **characterization** tests: they lock in today's behavior so plan 009
  (shared reconnecting-bridge base) and plan 005 (upgrade dedup) can refactor with
  confidence. If a future change *intentionally* alters router behavior, update
  these assertions in the same PR and call it out.
- A reviewer should confirm: zero production-code changes in this PR, and the
  proxy `open` (real upstream) path is deliberately left to e2e.
