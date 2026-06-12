# Plan 005: Deduplicate the 4 WebSocket-upgrade blocks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report — do
> not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cb83908..HEAD -- apps/control/src/app/workspace-routes.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `cb83908`, 2026-06-11

## Why this matters

`handleWorkspaceRoute` contains four near-identical ~20-line WebSocket-upgrade
blocks (`/ws/run`, `/ws/gamepad`, `/ws/lesson-load`, `/ws/import`). Each repeats:
check `server` + the `upgrade` header → call `requireWebSocketOrigin` (the
project's WS-CSRF defense) → `server.upgrade(...)` → return the
`undefined as unknown as Response` sentinel. The duplication is a latent security
footgun: a fifth WS route added by copy-paste can silently omit the origin check.
Extracting one helper makes the origin check structural — impossible to forget —
and removes ~60 lines of repetition.

## Current state

`apps/control/src/app/workspace-routes.ts`. The four blocks, each differing only
in the `data` payload passed to `server.upgrade`.

`/ws/run` (lines 132-153):

```ts
	if (suffix === "/ws/run" && request.method === "GET") {
		if (
			!server ||
			request.headers.get("upgrade")?.toLowerCase() !== "websocket"
		) {
			return new Response("Expected WebSocket upgrade.", { status: 426 });
		}
		const originError = requireWebSocketOrigin(request, storage.config.baseUrl);
		if (originError) {
			return originError;
		}
		const upgraded = server.upgrade(request, {
			data: {
				kind: "run",
				workspace: auth.workspace,
			},
		});
		if (!upgraded) {
			return new Response("WebSocket upgrade failed.", { status: 400 });
		}
		return undefined as unknown as Response;
	}
```

`/ws/gamepad` (lines 155-176) — identical shape, `data` is `{ kind: "gamepad", workspace: auth.workspace }`.

`/ws/lesson-load` (lines 486-508) — `data` is `{ kind: "lesson-load", workspace: auth.workspace, userId: auth.user.id } satisfies LessonLoadSocketData`.

`/ws/import` (lines 531-553) — `data` is `{ kind: "import", workspace: auth.workspace, userId: auth.user.id } satisfies ImportSocketData`.

Relevant imports already present at the top of the file: `requireWebSocketOrigin`,
`requireWorkspaceOwnership` (lines 12-13). The socket-data types
(`LessonLoadSocketData`, `ImportSocketData`, etc.) come from `../app/types` /
are referenced in the file already.

`server` has type `BunUpgradeServer | undefined` and `request` is a `Request`;
`storage.config.baseUrl` is the expected origin. The upgrade signature
(`apps/control/src/app/types.ts:20-25`):

```ts
export type BunUpgradeServer = {
	upgrade(
		request: Request,
		options: { data: SocketData; headers?: HeadersInit },
	): boolean;
};
```

## Commands you will need

| Purpose   | Command                                                | Expected on success |
|-----------|--------------------------------------------------------|---------------------|
| Typecheck | `bun run typecheck`                                    | exit 0, no errors   |
| Control tests | `bun run test`                                     | all pass            |
| E2E (mocked)  | `bun run e2e`                                      | all pass            |
| E2E security  | `bun run e2e:security`                             | all pass            |
| Lint/format (write) | `bun run check:fix`                          | exit 0              |

## Scope

**In scope** (the only file you should modify):
- `apps/control/src/app/workspace-routes.ts`

**Out of scope** (do NOT touch):
- `apps/control/src/app/websocket.ts` (the `open`/`message`/`close` handlers) —
  this plan only refactors the HTTP upgrade blocks, not the socket handlers.
- `apps/control/src/auth/middleware.ts` (`requireWebSocketOrigin`) — reuse it
  exactly; do not change its behavior.
- The `data` payload shapes — they must be byte-for-byte equivalent after the
  refactor (same `kind`, `workspace`, `userId` fields, same `satisfies` types).

## Git workflow

- Branch: `advisor/005-dedupe-ws-upgrade`
- Single commit; message e.g. `refactor(ws): extract shared upgradeWebSocket helper`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add an `upgradeWebSocket` helper

Add a module-level helper in `apps/control/src/app/workspace-routes.ts` (above
`handleWorkspaceRoute`). It encapsulates the guard + origin check + upgrade +
sentinel. It takes the already-built `data` payload so each call site keeps its
own typed payload:

```ts
function upgradeWebSocket(
	request: Request,
	server: BunUpgradeServer | undefined,
	baseUrl: string,
	data: SocketData,
): Response {
	if (
		!server ||
		request.headers.get("upgrade")?.toLowerCase() !== "websocket"
	) {
		return new Response("Expected WebSocket upgrade.", { status: 426 });
	}
	const originError = requireWebSocketOrigin(request, baseUrl);
	if (originError) {
		return originError;
	}
	const upgraded = server.upgrade(request, { data });
	if (!upgraded) {
		return new Response("WebSocket upgrade failed.", { status: 400 });
	}
	return undefined as unknown as Response;
}
```

Add `BunUpgradeServer` and `SocketData` to the imports from `./types` if they are
not already imported in this file (check the existing import block first; the file
already references the socket-data types). Confirm the actual exported names in
`apps/control/src/app/types.ts` before importing.

**Verify**: `bun run typecheck` → exit 0 (helper compiles; unused-warning is fine
until Step 2).

### Step 2: Replace each of the 4 blocks with a call

Replace each upgrade block's body with a single `return upgradeWebSocket(...)`,
preserving the exact `data` payload. Examples:

`/ws/run`:
```ts
	if (suffix === "/ws/run" && request.method === "GET") {
		return upgradeWebSocket(request, server, storage.config.baseUrl, {
			kind: "run",
			workspace: auth.workspace,
		});
	}
```

`/ws/gamepad`:
```ts
	if (suffix === "/ws/gamepad" && request.method === "GET") {
		return upgradeWebSocket(request, server, storage.config.baseUrl, {
			kind: "gamepad",
			workspace: auth.workspace,
		});
	}
```

`/ws/lesson-load`:
```ts
	if (suffix === "/ws/lesson-load" && request.method === "GET") {
		return upgradeWebSocket(request, server, storage.config.baseUrl, {
			kind: "lesson-load",
			workspace: auth.workspace,
			userId: auth.user.id,
		} satisfies LessonLoadSocketData);
	}
```

`/ws/import`:
```ts
	if (suffix === "/ws/import" && request.method === "GET") {
		return upgradeWebSocket(request, server, storage.config.baseUrl, {
			kind: "import",
			workspace: auth.workspace,
			userId: auth.user.id,
		} satisfies ImportSocketData);
	}
```

If TypeScript complains that the `satisfies`-typed object literal isn't assignable
to the `data: SocketData` parameter, the literal is still a valid `SocketData`
member — keep the `satisfies` for documentation; it will narrow fine. If it does
NOT compile, drop the `satisfies` (the union parameter type already constrains it)
rather than widening the helper signature.

**Verify**: `bun run typecheck` → exit 0.

### Step 3: Full verification

**Verify**:
- `bun run test` → all pass
- `bun run e2e` → all pass (the mocked tier exercises run/gamepad/import/lesson WS flows)
- `bun run e2e:security` → all pass (CSRF/origin specs still hold)
- `bun run check:fix` → exit 0

## Test plan

No new tests required — this is a behavior-preserving extraction, and the existing
e2e mocked tier already drives all four WS routes (login→editor→run→telemetry, plus
import/lesson-load flows) and the security tier covers origin rejection. Those are
the regression guard; run them per Step 3.

If you want belt-and-suspenders coverage, plan 008 adds direct WS-router tests —
but do not block this plan on it.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun run test` exits 0
- [ ] `bun run e2e` exits 0
- [ ] `bun run e2e:security` exits 0
- [ ] `grep -c "requireWebSocketOrigin" apps/control/src/app/workspace-routes.ts` returns `1` (now only inside the helper, down from 4 call sites — the import line also matches `grep`, so expect the count to drop; confirm there is exactly one *call*, inside `upgradeWebSocket`)
- [ ] `grep -c "server.upgrade(request" apps/control/src/app/workspace-routes.ts` returns `1`
- [ ] `git status --porcelain` shows only `apps/control/src/app/workspace-routes.ts` modified
- [ ] `plans/README.md` status row for 005 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any of the four `data` payloads cannot be expressed identically through the
  helper (e.g. a block sets `headers` on `server.upgrade` that the others don't) —
  re-read that block; do not silently drop a field.
- An e2e WS test fails after the refactor — that means a payload or the origin
  check changed; revert and report rather than tweaking the helper to make a test
  pass.
- The `satisfies` types (`LessonLoadSocketData`, `ImportSocketData`) are not
  importable/defined where expected — report the actual location.

## Maintenance notes

- Any **new** WebSocket route in this file must now go through `upgradeWebSocket`,
  which guarantees the origin/CSRF check. Add a one-line comment on the helper
  saying so, and a reviewer should reject new `server.upgrade(` calls outside it.
- This plan pairs with 003 (the broader CSRF/header hardening) and with the
  rejected "mutating HTTP routes lack Origin check" finding — the helper makes the
  WS-side check the single source of truth.
