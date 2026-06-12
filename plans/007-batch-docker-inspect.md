# Plan 007: Batch `docker inspect` in `managedContainerStats`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report — do
> not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cb83908..HEAD -- apps/control/src/containers/lifecycle.ts apps/control/src/containers/docker-client.ts`
> If either file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `cb83908`, 2026-06-11

## Why this matters

`managedContainerStats` runs on the `DockerStatsPoller` every 15 seconds for the
life of the process, and is also called on every admin "containers" page load. It
issues **one `docker inspect` subprocess per container, awaited serially**, on top
of the one `docker container ls` and one `docker stats` call it already makes
batched. With 30–50 student containers that is 30–50 serial subprocess spawns
every 15s just to assemble metrics; the serial latency can approach or exceed the
poll interval and stack ticks. `docker container inspect` accepts multiple names
in a single call and returns a JSON array, so the entire per-container fan-out
collapses into one subprocess.

## Current state

`apps/control/src/containers/lifecycle.ts:157-219` — `managedContainerStats`. It
already batches `ls` and `stats`, then loops `inspectContainer` per name:

```ts
export async function managedContainerStats(
	dockerRunner: DockerRunner,
): Promise<ManagedContainerStats[]> {
	const list = await runDocker(
		dockerRunner,
		["container", "ls", "-a", "--filter", "label=frc-sim.managed=true", "--format", "{{.Names}}"],
		true,
	);
	// ... parse names ...

	const statsByName = new Map<string, Partial<ManagedContainerStats>>();
	const stats = await runDocker(
		dockerRunner,
		["stats", "--no-stream", "--format", "{{json .}}", ...names],
		true,
	);
	// ... parse stats into statsByName ...

	const output: ManagedContainerStats[] = [];
	for (const name of names) {
		const inspected = await inspectContainer(dockerRunner, name);   // <-- N subprocesses, serial
		const labels = inspected?.Config?.Labels ?? {};
		const runtime = inspected ? containerRuntimeState(inspected) : null;
		const stat = statsByName.get(name);
		output.push({
			name,
			id: stat?.id ?? null,
			workspaceId: labels["frc-sim.workspace"] ?? null,
			role: labels["frc-sim.role"] ?? null,
			state: runtime,
			cpuPercent: stat?.cpuPercent ?? null,
			memoryUsage: stat?.memoryUsage ?? null,
			memoryLimit: stat?.memoryLimit ?? null,
			memoryPercent: stat?.memoryPercent ?? null,
		});
	}
	return output;
}
```

The single-name inspect helper, `apps/control/src/containers/docker-client.ts:86-101`:

```ts
export async function inspectContainer(
	dockerRunner: DockerRunner,
	name: string,
): Promise<DockerInspectContainer | null> {
	const result = await runDocker(dockerRunner, ["container", "inspect", name], true);
	if (result.exitCode !== 0) {
		return null;
	}
	const parsed = JSON.parse(result.stdout) as DockerInspectContainer[];
	return parsed[0] ?? null;
}
```

`docker container inspect name1 name2 ...` returns a JSON **array** of
`DockerInspectContainer`. The type (`apps/control/src/containers/types.ts:29-44`)
includes `Name?: string` — Docker returns it with a **leading slash** (e.g.
`/coderunner-workspace-abc`), so it must be stripped to match the `ls --format
{{.Names}}` names (which have no leading slash). Labels and runtime state are
read via `inspected.Config?.Labels` and `containerRuntimeState(inspected)`
(from `apps/control/src/containers/metadata.ts`).

`runDocker` (`docker-client.ts:74-84`) with `allowFailure = true` returns the
result even on non-zero exit.

## Commands you will need

| Purpose   | Command                                                       | Expected on success |
|-----------|---------------------------------------------------------------|---------------------|
| Typecheck | `bun run typecheck`                                           | exit 0, no errors   |
| Container tests | `bun test apps/control/src/__tests__/containers.test.ts` | all pass         |
| Metrics tests | `bun test apps/control/src/__tests__/metrics.test.ts`     | all pass            |
| Control tests | `bun run test`                                            | all pass            |
| Lint/format (write) | `bun run check:fix`                                 | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `apps/control/src/containers/docker-client.ts` — add a batched
  `inspectContainers` helper.
- `apps/control/src/containers/lifecycle.ts` — use it in `managedContainerStats`.
- A test file under `apps/control/src/__tests__/` — extend container/metrics
  coverage for the batched path (see Test plan).

**Out of scope** (do NOT touch):
- The existing single-name `inspectContainer` — leave it; it is used elsewhere
  (e.g. `local-docker-runtime-provider.ts`). Add a new batched helper rather than
  changing its signature.
- The `docker container ls` and `docker stats` calls — already batched; unchanged.
- The output `ManagedContainerStats` shape — must stay identical (same fields,
  same null semantics) so dashboards/metrics don't change.

## Git workflow

- Branch: `advisor/007-batch-docker-inspect`
- Commit per logical unit (helper, then use-site) or one commit; message e.g.
  `perf(containers): batch docker inspect in managedContainerStats`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a batched `inspectContainers` helper

In `apps/control/src/containers/docker-client.ts`, add:

```ts
export async function inspectContainers(
	dockerRunner: DockerRunner,
	names: string[],
): Promise<Map<string, DockerInspectContainer>> {
	const byName = new Map<string, DockerInspectContainer>();
	if (names.length === 0) {
		return byName;
	}
	const result = await runDocker(
		dockerRunner,
		["container", "inspect", ...names],
		true,
	);
	if (result.exitCode !== 0 || !result.stdout.trim()) {
		// Partial/failed inspect: return what we can (possibly empty). Callers
		// already tolerate a missing entry (null labels/state).
		try {
			const parsed = JSON.parse(result.stdout) as DockerInspectContainer[];
			for (const container of parsed) {
				const key = (container.Name ?? "").replace(/^\//u, "");
				if (key) byName.set(key, container);
			}
		} catch {
			// stdout wasn't valid JSON (e.g. all names missing); return empty map.
		}
		return byName;
	}
	const parsed = JSON.parse(result.stdout) as DockerInspectContainer[];
	for (const container of parsed) {
		const key = (container.Name ?? "").replace(/^\//u, "");
		if (key) byName.set(key, container);
	}
	return byName;
}
```

Confirm `DockerInspectContainer` and `DockerRunner` are already imported in this
file (they are used by `inspectContainer`); reuse the existing imports.

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Use the batched helper in `managedContainerStats`

In `apps/control/src/containers/lifecycle.ts`, replace the per-name inspect loop.
Before the output loop, fetch all inspects once:

```ts
	const inspectedByName = await inspectContainers(dockerRunner, names);

	const output: ManagedContainerStats[] = [];
	for (const name of names) {
		const inspected = inspectedByName.get(name) ?? null;
		const labels = inspected?.Config?.Labels ?? {};
		const runtime = inspected ? containerRuntimeState(inspected) : null;
		const stat = statsByName.get(name);
		output.push({
			name,
			id: stat?.id ?? null,
			workspaceId: labels["frc-sim.workspace"] ?? null,
			role: labels["frc-sim.role"] ?? null,
			state: runtime,
			cpuPercent: stat?.cpuPercent ?? null,
			memoryUsage: stat?.memoryUsage ?? null,
			memoryLimit: stat?.memoryLimit ?? null,
			memoryPercent: stat?.memoryPercent ?? null,
		});
	}
	return output;
```

Update the import at the top of `lifecycle.ts` to bring in `inspectContainers`
alongside the existing `inspectContainer`/`runDocker` imports from
`./docker-client`. If `inspectContainer` is no longer referenced in `lifecycle.ts`
after this change, remove it from the import to satisfy lint (check with
`grep -n "inspectContainer\b" apps/control/src/containers/lifecycle.ts`).

**Verify**: `bun run typecheck` → exit 0.

### Step 3: Run the container + metrics suites

**Verify**:
- `bun test apps/control/src/__tests__/containers.test.ts` → all pass
- `bun test apps/control/src/__tests__/metrics.test.ts` → all pass
- `bun run test` → all pass
- `bun run check:fix` → exit 0

## Test plan

First read `apps/control/src/__tests__/containers.test.ts` (and `metrics.test.ts`)
to see how `managedContainerStats` is driven — these tests pass a fake
`dockerRunner` that returns canned stdout per argv. Find the test(s) that currently
stub `["container", "inspect", <name>]` and the `ls`/`stats` calls.

Update/add coverage:

1. Adjust the fake `dockerRunner` so a **single** `["container", "inspect", a, b, ...]`
   call returns a JSON array of two+ containers (with `Name` values that include a
   leading `/`), and assert the resulting `ManagedContainerStats[]` maps labels,
   workspaceId, role, and state correctly to each name — proving the leading-slash
   stripping works.
2. Assert the fake `dockerRunner` received the inspect argv **once** (not once per
   name) — e.g. by counting calls whose first arg is `inspect`. This is the
   regression assertion that locks in the batching.
3. Keep/verify a case where a name is missing from the inspect output (container
   disappeared between `ls` and `inspect`): its entry still appears with
   `state: null` and null labels (graceful degradation, matching today).

Structural pattern: model on the existing `managedContainerStats` test in
`containers.test.ts` (reuse its fake-`dockerRunner` factory; do not invent a new
one).

Verification: `bun test apps/control/src/__tests__/containers.test.ts` → all pass,
including the call-count assertion. Sanity-check: assertion (2) should **fail** on
the old per-name-loop code.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun test apps/control/src/__tests__/containers.test.ts` passes, including an assertion that `docker inspect` is invoked once (not per-container)
- [ ] `bun test apps/control/src/__tests__/metrics.test.ts` passes
- [ ] `bun run test` exits 0
- [ ] `grep -n "for (const name of names)" apps/control/src/containers/lifecycle.ts` shows the loop no longer contains an `await inspectContainer(` call
- [ ] `git status --porcelain` shows only `docker-client.ts`, `lifecycle.ts`, and the touched test file modified
- [ ] `plans/README.md` status row for 007 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `ManagedContainerStats` output for the test fixtures differs in any field
  from the pre-change output (the refactor must be output-equivalent) — investigate
  the leading-slash stripping or the map lookup before proceeding.
- `docker container inspect` with multiple names behaves differently than assumed
  in the test harness (e.g. the fake `dockerRunner` keys on a single name) — adapt
  the fake, but if the real-Docker semantics are in doubt, report rather than guess.
- You discover `managedContainerStats` has other callers that depend on per-name
  inspect side effects — report.

## Maintenance notes

- If a future change needs per-container `docker inspect` for fields not in the
  batched output, prefer extending `inspectContainers` over reintroducing a
  per-name loop on a hot poller path.
- Reviewer should scrutinize: the leading-`/` stripping on `Name`, the empty-names
  short-circuit, and the call-count test (the actual perf guarantee).
- Related (not in this plan): `cleanupStoppedContainers` removes containers
  one-by-one, but it is a rare cleanup path (not a timer), so its per-item `docker
  rm` is acceptable and intentionally left alone.
