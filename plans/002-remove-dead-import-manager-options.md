# Plan 002: Remove the dead `ImportManagerOptions` parameter

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report — do
> not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cb83908..HEAD -- apps/control/src/imports.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `cb83908`, 2026-06-11

## Why this matters

`ImportManager` carries a speculative extension point that holds nothing and is
never read: a type `ImportManagerOptions = Record<string, never>` (a type that
can only ever be the empty object) and a constructor parameter `_options` that no
code references. This repo explicitly avoids speculative/unused code (the
maintainer previously removed an unrequested backup flow). Removing the dead
parameter is a small, safe simplification that makes the constructor honest about
what it needs.

## Current state

`apps/control/src/imports.ts:154-164`:

```ts
export type ImportManagerOptions = Record<string, never>;

export class ImportManager {
	private readonly rateLimiter = new ImportRateLimiter();
	private readonly activeImports = new Map<WorkspaceId, string>();

	constructor(
		readonly _storage: AppStorage,
		private readonly runtimeProvider: WorkspaceRuntimeProvider,
		readonly _options: ImportManagerOptions = {},
	) {}
```

`_options` is never referenced anywhere in the class body or elsewhere.

All instantiation sites pass only the first two arguments (so dropping the third
parameter is safe) — confirmed at:

- `apps/control/src/app.ts:135` — `new ImportManager(storage, runtimeProvider)`
- `apps/control/src/__tests__/imports.test.ts` lines 219, 260, 303, 337, 395, 426, 463 — `new ImportManager(app.storage, <provider-or-mock>)`
- `apps/control/src/__tests__/security/command-injection.test.ts` lines 49, 103, 169
- `apps/control/src/__tests__/security/path-traversal.test.ts` lines 64, 91

No site passes a third argument and nothing imports `ImportManagerOptions`.

## Commands you will need

| Purpose   | Command                                              | Expected on success |
|-----------|------------------------------------------------------|---------------------|
| Typecheck | `bun run typecheck`                                  | exit 0, no errors   |
| Import tests | `bun test apps/control/src/__tests__/imports.test.ts` | all pass         |
| Security tests | `bun test apps/control/src/__tests__/security` | all pass            |
| Lint/format (write) | `bun run check:fix`                        | exit 0              |

## Scope

**In scope** (the only file you should modify):
- `apps/control/src/imports.ts`

**Out of scope** (do NOT touch):
- Any call site (none pass the third argument, so none need changing).
- The `_storage` parameter — it uses the same `readonly _` underscore convention
  but is a different concern; leave it exactly as-is.

## Git workflow

- Branch: `advisor/002-drop-import-manager-options`
- Single commit; message e.g. `refactor(imports): drop unused ImportManagerOptions`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Delete the type and the constructor parameter

In `apps/control/src/imports.ts`:

1. Delete the line `export type ImportManagerOptions = Record<string, never>;`
   (line 154) and the blank line that separated it from the class if it leaves a
   double blank.
2. In the constructor, remove the third parameter
   `readonly _options: ImportManagerOptions = {},` (line 163). The constructor
   becomes:

```ts
	constructor(
		readonly _storage: AppStorage,
		private readonly runtimeProvider: WorkspaceRuntimeProvider,
	) {}
```

**Verify**: `grep -rn "ImportManagerOptions\|_options" apps/control/src` returns
no matches.

### Step 2: Typecheck and run the affected tests

**Verify**:
- `bun run typecheck` → exit 0
- `bun test apps/control/src/__tests__/imports.test.ts` → all pass
- `bun test apps/control/src/__tests__/security` → all pass

### Step 3: Format

**Verify**: `bun run check:fix` → exit 0.

## Test plan

No new tests needed — this removes dead code with no behavior. The existing
import + security suites already construct `ImportManager` with two args and fully
cover its behavior; they are the regression guard. Run them per Step 2.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn "ImportManagerOptions" apps/control/src` returns no matches
- [ ] `grep -rn "_options" apps/control/src/imports.ts` returns no matches
- [ ] `bun run typecheck` exits 0
- [ ] `bun test apps/control/src/__tests__/imports.test.ts` passes
- [ ] `bun test apps/control/src/__tests__/security` passes
- [ ] `git status --porcelain` shows only `apps/control/src/imports.ts` modified
- [ ] `plans/README.md` status row for 002 updated

## STOP conditions

Stop and report back (do not improvise) if:

- A call site that passes a **third argument** to `new ImportManager(...)` exists
  (the drift check or a typecheck error would reveal it) — that means the option
  became live; do not delete it, report instead.
- `grep` finds `_options` referenced anywhere in the class body — the parameter is
  actually used; stop.

## Maintenance notes

- If a future change genuinely needs per-instance import options, reintroduce a
  real (non-empty) options type at that point, with at least one field that is
  read. Do not restore an empty placeholder.
- Reviewer: confirm no call site changed (the diff should be confined to two
  deletions in `imports.ts`).
