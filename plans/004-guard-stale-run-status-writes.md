# Plan 004: Guard stale run-job status writes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report — do
> not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cb83908..HEAD -- apps/control/src/runs.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `cb83908`, 2026-06-11

## Why this matters

A rapid stop→start (or double-start) of a simulation run can let the **old**
run job's terminal status overwrite the **new** run's live status. `RunManager`
keys "the current job for a workspace" in `jobsByWorkspace`, and the per-workspace
status snapshot in `lastStatusByWorkspace` (read by reconnecting Driver-Station
clients via `getWorkspaceSnapshot`). When `start()` is called it registers the new
job immediately, but the old job's async `runJob` loop is still draining and will
eventually call `finishJob(...)`. `finishJob` correctly **guards** the
`jobsByWorkspace.delete` with an id check — but it calls `rememberStatus(...)`
*without* that guard, so the old job can stamp the workspace status to
`"stopped"`/`"failed"` while the new job is `"building"`/`"running"`. The visible
symptom: the DS UI briefly shows a just-started run as stopped, and a client that
reconnects in that window reads the stale snapshot. This fix makes the status
writes respect the same "am I still the current job" guard the delete already uses.

## Current state

`apps/control/src/runs.ts`. The `delete` is guarded but the status writes are not.

`finishJob` (lines 563-589):

```ts
	private finishJob(
		job: RunJob,
		state: "failed" | "stopped",
		code: number | null,
		signal: string | null = null,
	): void {
		if (job.finished) {
			return;
		}
		job.finished = true;
		this.releaseBuildSlot(job);
		this.setJobState(job, state, { finished: true, exitCode: code });
		this.rememberStatus(job, state);          // <-- UNGUARDED
		this.broadcast(job, { type: "status", status: state });
		this.broadcast(job, { type: "exit", code, signal });
		const terminalStatus = job.canceled ? "canceled" : state;
		runsTotal.inc({ terminal_status: terminalStatus });
		if (job.runningSinceMs !== null) {
			runActiveDuration.observe(
				{ terminal_status: terminalStatus },
				(performance.now() - job.runningSinceMs) / 1000,
			);
		}
		if (this.jobsByWorkspace.get(job.workspace.id)?.id === job.id) {  // <-- GUARD exists here
			this.jobsByWorkspace.delete(job.workspace.id);
		}
	}
```

`setJobState` (lines ~545-561) also calls `rememberStatus` unconditionally at the
end:

```ts
		this.storage.updateRunJob(update);
		this.rememberStatus(job, state);          // <-- UNGUARDED
	}
```

`start()` (lines 260-307) cancels the prior job and registers the new one:

```ts
	start(workspace: WorkspaceRow, connection?: RunConnection | null): string {
		this.cancelWorkspace(workspace.id);
		const runId = randomRunId();
		// ... build new job ...
		this.jobsByWorkspace.set(workspace.id, job);
		this.rememberStatus(job, "building");
		// ...
		void this.runJob(job);
		return runId;
	}
```

You will need to read `rememberStatus` and `lastStatusByWorkspace` (search for
both in `runs.ts`) to confirm `rememberStatus` is what writes
`lastStatusByWorkspace`, and that `broadcast` only sends to the job's own
`clients` set (broadcast to the old job's clients is harmless because those
clients moved to the new job's set in `start()` — confirm before relying on it).

## Commands you will need

| Purpose   | Command                                            | Expected on success |
|-----------|----------------------------------------------------|---------------------|
| Typecheck | `bun run typecheck`                                | exit 0, no errors   |
| Run tests | `bun test apps/control/src/__tests__/runs.test.ts` | all pass            |
| Control tests | `bun run test`                                 | all pass            |
| Lint/format (write) | `bun run check:fix`                      | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `apps/control/src/runs.ts`
- `apps/control/src/__tests__/runs.test.ts` (add a regression test)

**Out of scope** (do NOT touch):
- `start()` / `cancelWorkspace()` control flow — do not change how jobs are
  registered or canceled; only guard the status writes.
- The `broadcast` calls in `finishJob` — leave them; a finished old job
  broadcasting `exit` to its (now-migrated) client set is acceptable and changing
  it is a separate concern.
- `storage.updateRunJob` and the metrics increments — those are per-job-row and
  correct as-is.

## Git workflow

- Branch: `advisor/004-guard-run-status`
- Single commit; message e.g. `fix(runs): don't let a stale job overwrite current workspace status`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add an "is current job" guard helper

In `RunManager`, add a small private helper (near `rememberStatus`):

```ts
	private isCurrentJob(job: RunJob): boolean {
		return this.jobsByWorkspace.get(job.workspace.id)?.id === job.id;
	}
```

### Step 2: Guard the workspace-level status write in `finishJob`

In `finishJob`, replace the unconditional `this.rememberStatus(job, state);` with
a guarded write so a superseded old job does not overwrite the current snapshot:

```ts
		if (this.isCurrentJob(job)) {
			this.rememberStatus(job, state);
		}
```

Keep the existing `this.jobsByWorkspace.get(...)?.id === job.id` block for the
delete, or replace it with `if (this.isCurrentJob(job)) { this.jobsByWorkspace.delete(job.workspace.id); }`
for consistency (either is fine; the behavior must be identical).

### Step 3: Guard the workspace-level status write in `setJobState`

In `setJobState`, wrap the trailing `this.rememberStatus(job, state);` in the same
guard:

```ts
		this.storage.updateRunJob(update);
		if (this.isCurrentJob(job)) {
			this.rememberStatus(job, state);
		}
```

`storage.updateRunJob(update)` stays unconditional (it is per-job-row, not the
shared snapshot).

**Verify**: `bun run typecheck` → exit 0.

### Step 4: Confirm the new-job `start()` path still records status

`start()` calls `this.rememberStatus(job, "building")` *after*
`this.jobsByWorkspace.set(workspace.id, job)`, so `isCurrentJob(job)` is true there
— no change needed. Read it to confirm the `set` precedes any status write.

**Verify**: `bun test apps/control/src/__tests__/runs.test.ts` → all pass (no
regression).

## Test plan

- New test in `apps/control/src/__tests__/runs.test.ts`: simulate the race.
  Using the existing test harness in that file (it constructs a `RunManager` with
  a fake/command factory — model your setup on the existing tests there):
  1. Start run A on a workspace.
  2. Start run B on the same workspace (this calls `cancelWorkspace` on A and
     registers B).
  3. Drive run A to its terminal `finishJob` (e.g. let A's fake command exit /
     fire its cancellation) **after** B is registered.
  4. Assert `getWorkspaceSnapshot(workspaceId)` (or whatever the existing tests
     use to read current status) reflects **run B's** status, not A's `"stopped"`.
- Name it e.g. `"a superseded run does not overwrite the current run's status"`.
- Structural pattern: copy the setup/teardown and fake-command wiring from an
  existing test in `runs.test.ts` (do not invent a new harness).
- Verification: `bun test apps/control/src/__tests__/runs.test.ts` → all pass,
  including the new test, and the new test **fails** if you revert Step 2
  (sanity-check the guard actually matters).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun test apps/control/src/__tests__/runs.test.ts` passes, including a new test for the supersede race
- [ ] `bun run test` exits 0
- [ ] `grep -n "isCurrentJob" apps/control/src/runs.ts` shows the guard used in both `finishJob` and `setJobState`
- [ ] `git status --porcelain` shows only `apps/control/src/runs.ts` and `apps/control/src/__tests__/runs.test.ts` modified
- [ ] `plans/README.md` status row for 004 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `rememberStatus` turns out NOT to write the shared `lastStatusByWorkspace`
  snapshot (i.e. the "Current state" assumption is wrong) — re-read and report;
  the guard target may be different.
- The new regression test cannot be made to fail on the un-guarded code (you
  cannot reproduce the race with the existing harness) — report; the fix may be
  guarding a path that is already safe, and we should confirm the bug before
  shipping the guard.
- Guarding `setJobState`'s `rememberStatus` breaks an existing test that expects a
  non-current job to update the snapshot — that would reveal an intentional
  behavior; stop and report rather than deleting the test.

## Maintenance notes

- If run lifecycle gains more places that write `lastStatusByWorkspace`, route
  them through the same `isCurrentJob` guard.
- Reviewer should scrutinize: the guard is applied to the **shared** snapshot
  writes only, not to per-job-row persistence (`storage.updateRunJob`) or metrics.
- A related, lower-severity item left out of this plan: `timeoutBeforeReadiness`
  can mislabel a clean exit as `"canceled"` in metrics if the real exit lands
  during its awaited `recordLog`. Not fixed here; note it if you touch the
  readiness-timeout path.
