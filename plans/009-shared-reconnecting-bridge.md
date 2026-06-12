# Plan 009: Extract a shared reconnecting-WebSocket-bridge base

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report — do
> not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **This is the highest-risk plan in the set.** It refactors live-telemetry code.
> Land plan 008 (WS router tests) first and keep the full `halsim` + `nt4`
> suites green at every step. If the abstraction starts fighting the two
> protocols' real differences, the correct outcome may be to STOP and leave the
> bridges separate — see STOP conditions. A smaller, certain win beats a risky
> big refactor.
>
> **Drift check (run first)**: `git diff --stat cb83908..HEAD -- apps/control/src/halsim.ts apps/control/src/nt4-auto.ts`
> If either file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/008-websocket-router-tests.md (land first as a regression net)
- **Category**: tech-debt
- **Planned at**: commit `cb83908`, 2026-06-11

## Why this matters

`HalSimBridge` (`halsim.ts`, 491 lines) and `Nt4AutoChooserBridge`
(`nt4-auto.ts`, 634 lines) independently implement the **same connection-lifecycle
scaffolding**: a `Map<WorkspaceId, Entry>`, an `ensureConnected` that reconnects on
URL change, an `open()` that wires `open`/`message`/`close`/`error` listeners each
guarded by the same `if (entry.socket !== socket) return` stale-socket check, a
`disconnect`, a `close`, and a `snapshotFromEntry`. Because the scaffolding is
duplicated, it has **already drifted**: `HalSimBridge` has exponential-backoff
auto-reconnect (`scheduleReconnect`, `reconnectBackoffMs`) that
`Nt4AutoChooserBridge` lacks. Every lifecycle bug must be fixed twice. Extracting
the shared scaffolding into a base class — while keeping each bridge's
**protocol** and **reconnect strategy** as explicit hooks — removes the duplication
and the drift surface.

**Critical correctness constraint:** the two bridges deliberately differ and that
difference MUST be preserved:
- `HalSimBridge.open`'s close handler calls `scheduleReconnect` (auto-reconnect
  with backoff). 
- `Nt4AutoChooserBridge.open`'s close handler does **not** reconnect — it relies on
  the frontend's ~1s poll re-calling `ensureConnected`. 

Do not "unify" these into one reconnect behavior. The base must make reconnect an
opt-in hook so nt4 stays poll-driven and halsim stays self-reconnecting.

## Current state

### `apps/control/src/halsim.ts`

`BridgeEntry` (lines 36-43) extends the snapshot with `workspaceId`, `upstreamUrl`,
`socket`, `reconnectTimer`, `reconnectBackoffMs`, `shouldReconnect`.

`ensureConnected` (lines 150-180): on URL change → `disconnect` + recreate entry;
create default entry if missing; `entry.shouldReconnect = true`; if no socket and
no pending reconnect timer → `this.open(entry)`.

`open` (lines 342-403): sets `connection="reconnecting"`, creates socket via
`webSocketFactory`, wires listeners each guarded by `entry.socket !== socket`:
- `open` → connected + `sendDs({">ds":true,...})`, resets backoff.
- `message` → `handleMessage(entry, raw)`.
- `close` → null socket, set reconnecting/disconnected, **`if (entry.shouldReconnect) this.scheduleReconnect(entry)`**.
- `error` → set `entry.error`.

`scheduleReconnect` (lines 405-423): backoff timer, `unref()`'d, re-`open()`s.

`disconnect` (lines 312-333): clears `shouldReconnect`, clears reconnect timer,
nulls + closes socket, sets disconnected.

`close` (lines 335-340): disconnect all, clear map.

`snapshotFromEntry` (lines 481-490): projects entry → `HalSimBridgeSnapshot`.

### `apps/control/src/nt4-auto.ts`

`Nt4AutoEntry` (search the file for the type) carries `workspaceId`, `upstreamUrl`,
`socket`, the snapshot fields, plus protocol state (`topicsById`, `topicsByName`,
`valuesByName`, `publishedTopics`). It has **no** `reconnectTimer` /
`reconnectBackoffMs` / `shouldReconnect`.

`ensureConnected` (lines 357-389): on URL change → disconnect + recreate; create
entry if missing; if no socket → `this.open(entry)`. (Note: simpler than halsim —
no `shouldReconnect`, no reconnect-timer guard.)

`open` (lines 476-535): sets `connection="reconnecting"`, creates socket with NT4
subprotocols, `binaryType="arraybuffer"`, wires listeners guarded by
`entry.socket !== socket`:
- `open` → connected + re-publish topics + `subscribe(["/"])`.
- `message` → `handleMessage(entry, event.data)`.
- `close` → null socket, set **disconnected** (NO reconnect scheduled).
- `error` → set `entry.error`.

`disconnect` (lines 451-467), `close` (lines 469-474), `snapshotFromEntry`
(lines 621+): same scaffolding shape as halsim, different snapshot type
(`AutoChoosersResponse`).

### What is genuinely shared vs. divergent

Shared (extract to base): the `entries` map, `ensureConnected`'s URL-change +
create-entry + maybe-open flow, the socket-identity-guarded listener wiring shape,
`disconnect`, `close`, and the `snapshotFromEntry` call indirection.

Divergent (keep as subclass hooks): socket construction (nt4 passes subprotocols +
sets `binaryType`), the `open`-event protocol handshake (halsim `sendDs`; nt4
publish+subscribe), `message` decoding, the snapshot projection/type, and — most
importantly — the **close→reconnect strategy** (halsim schedules backoff; nt4 does
nothing).

## Commands you will need

| Purpose   | Command                                              | Expected on success |
|-----------|------------------------------------------------------|---------------------|
| Typecheck | `bun run typecheck`                                  | exit 0, no errors   |
| HalSim tests | `bun test apps/control/src/__tests__/halsim.test.ts` | all pass         |
| NT4 tests | `bun test apps/control/src/__tests__/scope-and-nt4.test.ts` | all pass     |
| Gamepad tests | `bun test apps/control/src/__tests__/gamepad.test.ts` | all pass        |
| WS router tests (plan 008) | `bun test apps/control/src/__tests__/websocket-router.test.ts` | all pass |
| Control tests | `bun run test`                                   | all pass            |
| E2E (mocked)  | `bun run e2e`                                    | all pass            |
| Lint/format (write) | `bun run check:fix`                        | exit 0              |

(First confirm the NT4 test file name: `ls apps/control/src/__tests__ | grep -i nt4`.
The audit saw NT4 coverage under `scope-and-nt4.test.ts`; verify before relying on
it.)

## Scope

**In scope** (the only files you should modify/create):
- `apps/control/src/ws-bridge.ts` (new — the shared base class)
- `apps/control/src/halsim.ts` (refactor onto the base)
- `apps/control/src/nt4-auto.ts` (refactor onto the base)

**Out of scope** (do NOT touch):
- The public method signatures of `HalSimBridge` and `Nt4AutoChooserBridge`
  (`ensureConnected`, `getSnapshot`, `applyDriverStationPatch`, `applyJoystickState`,
  `releaseJoystick`, `select`, `disconnect`, `close`, and the exported snapshot
  types) — callers in `app/websocket.ts`, `app/status.ts`, `gamepad.ts`, and
  `app.ts` depend on them; they must remain byte-for-byte compatible.
- The reconnect strategy difference — preserve it (halsim reconnects, nt4 doesn't).
- The protocol logic (DS field parsing, MsgPack decode, topic management) — move it
  verbatim into the subclass hooks; do not "improve" it.
- Plan 008's test file — it is the regression net; do not edit it to make the
  refactor pass.

## Git workflow

- Branch: `advisor/009-shared-ws-bridge`
- Commit per step (base added; halsim migrated; nt4 migrated) so each step's green
  test run is captured. Message style e.g.
  `refactor(bridges): extract shared ReconnectingWsBridge base`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

> Work in small, independently-green steps. After **every** step run the relevant
> bridge's test file; never proceed on red.

### Step 1: Define the base class with hooks

Create `apps/control/src/ws-bridge.ts`. Define an abstract/generic base that owns
the shared scaffolding and exposes hooks for the divergent parts. Sketch (adapt
field/hook names to fit cleanly):

```ts
export type BridgeEntryBase<W> = {
	workspaceId: W;
	upstreamUrl: string;
	socket: WebSocket | null;
	connection: "disconnected" | "reconnecting" | "connected";
	connected: boolean;
	stale: boolean;
	lastMessageAt: string | null;
	error: string | null;
};

export abstract class ReconnectingWsBridge<W, Entry extends BridgeEntryBase<W>> {
	protected readonly entries = new Map<W, Entry>();

	// Hooks subclasses MUST implement:
	protected abstract createEntry(workspaceId: W, upstreamUrl: string): Entry;
	protected abstract createSocket(entry: Entry): WebSocket;      // nt4 adds subprotocols + binaryType
	protected abstract onSocketOpen(entry: Entry): void;           // halsim sendDs / nt4 publish+subscribe
	protected abstract onSocketMessage(entry: Entry, data: unknown): void;
	// Reconnect strategy hook — base calls this from the close handler.
	// halsim overrides to schedule backoff; nt4 leaves it a no-op.
	protected onSocketClosed(_entry: Entry): void {}

	protected open(entry: Entry): void { /* shared: set reconnecting, createSocket,
		wire the 4 listeners each guarded by `entry.socket !== socket`, call the
		hooks, and call onSocketClosed in the close listener */ }

	// Shared concrete methods:
	protected ensureEntry(workspaceId: W, upstreamUrl: string): Entry { /* URL-change
		disconnect + recreate, create-if-missing */ }
	disconnect(workspaceId: W): void { /* shared teardown */ }
	close(): void { /* disconnect all, clear map */ }
}
```

Carry over the exact stale-guard semantics: in every listener, the **first** line is
`if (entry.socket !== socket) return;` (halsim's open/message also additionally
check `!entry.shouldReconnect` — that belongs to halsim's reconnect strategy, so
keep it in the halsim subclass, e.g. by overriding the relevant hook or by storing
`shouldReconnect` on the halsim entry and short-circuiting in its hooks).

**Verify**: `bun run typecheck` → exit 0 (base compiles; unused until Step 2-3).

### Step 2: Migrate `HalSimBridge` onto the base

Make `HalSimBridge extends ReconnectingWsBridge<WorkspaceId, BridgeEntry>`. Move:
- entry creation → `createEntry` (include `reconnectTimer`, `reconnectBackoffMs`,
  `shouldReconnect`).
- socket construction → `createSocket` (plain `webSocketFactory(url)`).
- the `open`-event handshake (`sendDs({">ds":true,...})` + backoff reset) → `onSocketOpen`.
- `handleMessage` → `onSocketMessage`.
- **`scheduleReconnect`** → `onSocketClosed` override (schedule the backoff timer).
- Keep `applyDriverStationPatch`, `applyJoystickState`, `releaseJoystick`, `sendDs`,
  `getSnapshot`, `snapshotFromEntry` as halsim-specific methods.
- Preserve `shouldReconnect` handling and the `disconnect` clearing of the reconnect
  timer (override `disconnect` to also clear the timer, calling `super.disconnect`
  or replicating the shared teardown — whichever keeps behavior identical).

Keep the public API identical. The `ensureConnected` public method stays on
`HalSimBridge` (it has halsim-specific `shouldReconnect = true` semantics); have it
delegate to the base `ensureEntry` + `open`.

**Verify**:
- `bun run typecheck` → exit 0
- `bun test apps/control/src/__tests__/halsim.test.ts` → all pass
- `bun test apps/control/src/__tests__/gamepad.test.ts` → all pass (gamepad drives halsim)

If any halsim/gamepad test fails, the migration changed behavior — fix the
subclass to match the **original** behavior, or STOP (see STOP conditions). Do not
edit the tests.

### Step 3: Migrate `Nt4AutoChooserBridge` onto the base

Make `Nt4AutoChooserBridge extends ReconnectingWsBridge<WorkspaceId, Nt4AutoEntry>`.
Move:
- entry creation → `createEntry` (include `topicsById`, `topicsByName`,
  `valuesByName`, `publishedTopics`).
- socket construction → `createSocket` (pass NT4 subprotocols, set
  `binaryType = "arraybuffer"`).
- the `open`-event handshake (re-publish topics + `subscribe`) → `onSocketOpen`.
- `handleMessage` → `onSocketMessage`.
- **Do NOT override `onSocketClosed`** — nt4 must NOT auto-reconnect (the base
  default no-op preserves the poll-driven behavior). The close handler still nulls
  the socket and sets `disconnected` (that's shared base behavior); just no
  reconnect scheduling.
- Keep `select`, `publishStringTopic`, `sendJson`, `getSnapshot`,
  `snapshotFromEntry`, and the MsgPack codec as nt4-specific.

Keep the public API identical. `ensureConnected` stays on `Nt4AutoChooserBridge`
delegating to the base.

**Verify**:
- `bun run typecheck` → exit 0
- `bun test apps/control/src/__tests__/scope-and-nt4.test.ts` (verify the real file
  name first) → all pass

### Step 4: Full verification

**Verify**:
- `bun run test` → all pass
- `bun test apps/control/src/__tests__/websocket-router.test.ts` (plan 008) → all pass
- `bun run e2e` → all pass (mocked tier drives real telemetry flows end to end)
- `bun run check:fix` → exit 0

### Step 5: Confirm the drift is closed

Confirm both bridges now share the lifecycle scaffolding and that the reconnect
difference is explicit and intentional (halsim overrides `onSocketClosed`; nt4 does
not). Add a short comment on the base's `onSocketClosed` hook documenting that nt4
intentionally leaves it a no-op (poll-driven) while halsim schedules backoff.

## Test plan

No new behavior, so no new behavioral tests are required — the existing
`halsim.test.ts`, the NT4 test file, `gamepad.test.ts`, plan 008's
`websocket-router.test.ts`, and the `bun run e2e` mocked tier are the regression
net. They must ALL stay green through every step.

Optionally (nice-to-have, not required): add one test asserting the **divergence**
is preserved — e.g. that after an upstream close, a halsim entry schedules a
reconnect (its `webSocketFactory` is called again after the backoff) while an nt4
entry does not reconnect until `ensureConnected` is called again. Use the
`FakeWebSocket` pattern from `gamepad.test.ts` and fake timers if needed. If this
proves fiddly, skip it — the existing suites already cover behavior.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `apps/control/src/ws-bridge.ts` exists and is `extends`-ed by both bridges
- [ ] `grep -n "extends ReconnectingWsBridge" apps/control/src/halsim.ts apps/control/src/nt4-auto.ts` shows both
- [ ] `bun run typecheck` exits 0
- [ ] `bun test apps/control/src/__tests__/halsim.test.ts` passes
- [ ] NT4 test file passes (`bun test apps/control/src/__tests__/scope-and-nt4.test.ts` or the verified name)
- [ ] `bun test apps/control/src/__tests__/gamepad.test.ts` passes
- [ ] `bun test apps/control/src/__tests__/websocket-router.test.ts` passes
- [ ] `bun run test` exits 0
- [ ] `bun run e2e` exits 0
- [ ] Public method signatures of both bridges are unchanged (no caller in `app/`, `gamepad.ts` needed editing — `git status` shows only the 3 in-scope files)
- [ ] `plans/README.md` status row for 009 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Preserving the halsim-vs-nt4 reconnect difference forces the base to grow
  conditional branches on "which bridge am I" — that means the abstraction is wrong;
  STOP and report. **Leaving the two bridges separate is an acceptable outcome** if
  a clean base can't express both without special-casing.
- Any existing halsim/nt4/gamepad/e2e test fails and the only way to make it pass is
  to change the test or alter a public signature — STOP; the refactor must be
  behavior-preserving.
- A caller outside the 3 in-scope files needs editing — that means a public
  signature drifted; STOP and report.
- The migration balloons past a clean base + two thin subclasses (e.g. the base
  needs >2 abstract hooks beyond `createEntry`/`createSocket`/`onSocketOpen`/
  `onSocketMessage`/`onSocketClosed`) — reassess whether the win is worth it.

## Maintenance notes

- After this lands, lifecycle fixes (stale-guard, teardown, reconnect) are made once
  in `ws-bridge.ts`. A reviewer should verify the nt4 close path still does NOT
  reconnect and the halsim close path still schedules backoff — that divergence is
  the whole reason the prior duplication drifted.
- If a third WS bridge is ever added (e.g. a new telemetry source), it should
  `extend ReconnectingWsBridge` and implement the hooks — note this in the base's
  doc comment.
- Watch in review: the `if (entry.socket !== socket) return` stale-guard must be the
  first line of every listener in the base; losing it reintroduces stale-callback
  bugs the originals carefully avoided.
