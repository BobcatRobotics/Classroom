# Plan 006: Apply capacity admission to container adoption (restart path)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report — do
> not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cb83908..HEAD -- apps/control/src/containers/local-docker-runtime-provider.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `cb83908`, 2026-06-11

## Why this matters

`MAX_ACTIVE_CONTAINERS` is the control plane's host-protection cap on how many
student containers run simultaneously. The cap is enforced only on the **create**
path. When a workspace already has a container that is **stopped** (the idle
sweep stops — but does not remove — containers), reconnecting **restarts** it via
`docker start` in `adoptCodeContainer`, and that happens **before** the capacity
check. After an idle sweep stops many containers, a wave of students reconnecting
at once can all adopt-and-restart past the configured cap, defeating its purpose
and risking host exhaustion. This plan gates the restart-from-stopped path through
the same admission control the create path uses, so restarts count against the cap
(and are rejected with the normal capacity error when full). Adoption of an
**already-running** container is unaffected — it is already counted, so it must
not consume a new slot.

## Current state

`apps/control/src/containers/local-docker-runtime-provider.ts`.

`ensureCodeContainerInner` adopts first, then gates the create path (lines 604-637):

```ts
	private async ensureCodeContainerInner(
		workspace: WorkspaceRow,
	): Promise<CodeContainerStatus> {
		const expectedName = codeContainerName(workspace.id);
		const existing = await this.inspectContainer(expectedName);
		if (existing) {
			const adopted = await this.adoptCodeContainer(
				workspace,
				expectedName,
				existing,
			);
			if (adopted) {
				return adopted;            // <-- adoption returns BEFORE capacity check
			}
		}

		// Admission control: serialize capacity check + pending increment
		await this.withAdmissionLock(async () => {
			await this.checkCapacity();
		});

		const createdAt = performance.now();
		let createdOk = false;
		try {
			const result = await this.createWithRetries(workspace);
			createdOk = true;
			return result;
		} finally {
			if (createdOk) {
				containerStartDuration.observe((performance.now() - createdAt) / 1000);
			}
			this.pendingCreates = Math.max(0, this.pendingCreates - 1);
		}
	}
```

`checkCapacity` (lines 588-602) throws `CapacityExceededError` when at cap and
otherwise increments `this.pendingCreates`:

```ts
	private async checkCapacity(): Promise<void> {
		const cap = this.storage.getEffectiveMaxActiveContainers();
		const running = await this.countRunningContainers();
		const active = running + this.pendingCreates;
		if (active >= cap) {
			log.warn("capacity exceeded", { cap, active, pending: this.pendingCreates });
			throw new CapacityExceededError(cap, active);
		}
		log.debug("capacity admitted", { cap, active: active + 1 });
		this.pendingCreates += 1;
	}
```

`adoptCodeContainer` (lines 408-475) — validates labels/ports (rm -f + return null
on mismatch), returns a lease if the container is **already Running**, and
**otherwise `docker start`s a stopped container** and returns a lease:

```ts
	private async adoptCodeContainer(
		workspace: WorkspaceRow,
		name: string,
		container: DockerInspectContainer,
	): Promise<CodeContainerStatus | null> {
		if (!v2LabelsMatch(container, workspace.id)) {
			await this.runDocker(["rm", "-f", name], true);
			return null;
		}
		// ... port validation, rm -f + return null on mismatch ...

		if (container.State?.Running) {
			const lease = this.storage.upsertCodeContainerLease({ /* running */ });
			return statusFromLease(this.storage.config.codeImage, lease, "running");
		}

		const start = await this.runDocker(["start", name], true);   // <-- BYPASSES cap
		if (start.exitCode !== 0) {
			await this.runDocker(["rm", "-f", name], true);
			return null;
		}
		const restarted = await this.inspectContainer(name);
		// ... validate restarted, rm -f + return null on mismatch ...
		const lease = this.storage.upsertCodeContainerLease({ /* restarted */ });
		return statusFromLease(this.storage.config.codeImage, lease, lease.code_state);
	}
```

Key facts:
- `checkCapacity`, `withAdmissionLock`, `countRunningContainers`, `pendingCreates`
  are all private members of the same class — directly callable from
  `adoptCodeContainer`.
- `countRunningContainers()` counts **running** containers; a stopped container is
  not counted until it is started, and `pendingCreates` covers the in-flight slot
  in between (this is exactly how the create path avoids double-counting).
- The running-adoption branch (`container.State?.Running`) must stay un-gated.

## Commands you will need

| Purpose   | Command                                                   | Expected on success |
|-----------|-----------------------------------------------------------|---------------------|
| Typecheck | `bun run typecheck`                                       | exit 0, no errors   |
| Capacity tests | `bun test apps/control/src/__tests__/capacity.test.ts` | all pass         |
| Container tests | `bun test apps/control/src/__tests__/containers.test.ts` | all pass        |
| Control tests | `bun run test`                                        | all pass            |
| Lint/format (write) | `bun run check:fix`                             | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `apps/control/src/containers/local-docker-runtime-provider.ts`
- `apps/control/src/__tests__/capacity.test.ts` (add regression tests)

**Out of scope** (do NOT touch):
- The **running**-container adoption branch (`if (container.State?.Running)`) — it
  must remain un-gated (already counted).
- The label/port validation that does `rm -f` + `return null` — keep it before any
  capacity gating, so an invalid container is cleaned up and the create path takes
  over with its own check.
- `checkCapacity` / `withAdmissionLock` internals — reuse them; do not change their
  signatures or semantics.
- The idle sweep / `stopWorkspace` (it stops without removing — that is by design;
  this plan handles the consequence, not the stop behavior).

## Git workflow

- Branch: `advisor/006-capacity-on-adoption`
- Single commit; message e.g. `fix(containers): count restarted (adopted) containers against capacity cap`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Gate the stopped-container restart in `adoptCodeContainer`

In `adoptCodeContainer`, **after** the `if (container.State?.Running) { ... return ...; }`
block and **before** the `const start = await this.runDocker(["start", name], true);`
line, acquire an admission slot; then wrap the remainder of the restart path
(from `docker start` through the final `return statusFromLease(...)`, including the
intermediate `rm -f` + `return null` early-exits) in a `try { ... } finally { ... }`
that releases the slot. The shape:

```ts
		// Restarting a stopped container consumes a capacity slot, exactly like a
		// fresh create. Without this, a reconnect storm after an idle sweep
		// (which stops but does not remove containers) can exceed MAX_ACTIVE_CONTAINERS.
		await this.withAdmissionLock(async () => {
			await this.checkCapacity();
		});
		try {
			const start = await this.runDocker(["start", name], true);
			if (start.exitCode !== 0) {
				await this.runDocker(["rm", "-f", name], true);
				return null;
			}
			const restarted = await this.inspectContainer(name);
			if (!restarted || !v2LabelsMatch(restarted, workspace.id)) {
				await this.runDocker(["rm", "-f", name], true);
				return null;
			}
			// ... existing port-validation + lease + return statusFromLease(...) ...
			return statusFromLease(this.storage.config.codeImage, lease, lease.code_state);
		} finally {
			this.pendingCreates = Math.max(0, this.pendingCreates - 1);
		}
```

Preserve every existing line inside the restart path exactly (the port checks, the
`rm -f` cleanups, the `upsertCodeContainerLease` call) — you are only wrapping them
in `try/finally` and prepending the admission gate. The `finally` decrement mirrors
`ensureCodeContainerInner`'s create path so the slot is released on every exit
(success, `return null`, or thrown `CapacityExceededError` — note: if
`checkCapacity` throws, it threw *before* the `try`, so it did not increment and
the `finally` is not entered; that is correct).

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Confirm no double-gating in `ensureCodeContainerInner`

`ensureCodeContainerInner` returns early when `adoptCodeContainer` returns non-null,
so the create-path admission block is skipped for a successful adoption — no double
increment. When adoption returns `null` (invalid container, removed), the create
path runs its own admission as before. Re-read `ensureCodeContainerInner` to
confirm you did **not** need to change it.

**Verify**: `bun test apps/control/src/__tests__/containers.test.ts` → all pass.

### Step 3: Run the capacity suite

**Verify**: `bun test apps/control/src/__tests__/capacity.test.ts` → all pass
(existing tests must still pass; the create-path behavior is unchanged).

## Test plan

Add regression tests in `apps/control/src/__tests__/capacity.test.ts`. First read
that file to learn how it sets up a provider with a fake `dockerRunner` and how it
drives containers to "running" / "stopped" states and asserts
`CapacityExceededError`. Model the new tests on the existing ones. Cover:

1. **Restart counts against the cap**: with the cap already reached by running
   containers, calling the ensure/start path for a workspace whose container exists
   but is **stopped** rejects with `CapacityExceededError` (the restart is gated),
   rather than starting an over-cap container.
2. **Running adoption is not gated**: with the cap reached, calling the ensure path
   for a workspace whose container is **already running** returns its status
   successfully (no `CapacityExceededError`) — adopting an already-counted container
   must not be rejected.
3. **Slot is released after a successful restart**: a restart when **below** cap
   succeeds and does not leak `pendingCreates` (a subsequent create still admits up
   to the cap, not cap-1). If the test harness can't observe `pendingCreates`
   directly, assert it indirectly: after a successful restart below cap, a further
   create still succeeds up to the documented limit.

Name them descriptively, e.g.
`"restarting a stopped container is rejected when at capacity"`.

Verification: `bun test apps/control/src/__tests__/capacity.test.ts` → all pass,
including the new tests. Sanity-check: test (1) should **fail** if you revert Step 1.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun test apps/control/src/__tests__/capacity.test.ts` passes, with new tests for the restart-gating and running-adoption cases
- [ ] `bun test apps/control/src/__tests__/containers.test.ts` passes
- [ ] `bun run test` exits 0
- [ ] `grep -n "checkCapacity" apps/control/src/containers/local-docker-runtime-provider.ts` shows it called in BOTH `adoptCodeContainer` (restart path) and `ensureCodeContainerInner` (create path)
- [ ] `git status --porcelain` shows only the provider file and `capacity.test.ts` modified
- [ ] `plans/README.md` status row for 006 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The capacity suite cannot drive a "stopped existing container" scenario through
  the fake `dockerRunner` (the harness doesn't model stopped containers) — report;
  the test may need a harness extension that's worth a maintainer decision.
- Gating the restart path breaks an existing capacity/container test in a way that
  reveals an intended behavior (e.g. a test that expects a reconnect to always
  succeed even at cap) — stop and report; the product decision (reject reconnect vs
  allow over-cap) belongs to the maintainer.
- You find `withAdmissionLock`/`checkCapacity`/`pendingCreates` are not accessible
  from `adoptCodeContainer` (e.g. moved to another module) — report the new shape.

## Maintenance notes

- The cap now means "max running OR restarting student containers." If a future
  change removes stopped containers on idle sweep (instead of just stopping them),
  this restart path becomes dead and the gating is harmless — but revisit then.
- A reviewer should scrutinize: the running-adoption branch stays un-gated; the
  `finally` decrement runs on every exit of the restart path; and `checkCapacity`'s
  throw happens before the `try` so it doesn't leave a leaked `pendingCreates`.
- Related (not in this plan): the three non-transactional `clearReservedPort`
  calls in `createWithRetries` (lines ~675-677) transiently mark the lease
  `code_state='error'` during port-bind retries. Separate, lower-severity item.
