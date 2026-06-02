# 029 — Lessons & Modules

Status: **Accepted (implementation)** — 2026-05-29

Source of truth for scope and locked decisions: [`Lessons-Design.md`](../../Lessons-Design.md)
(D1–D13). This record captures the **implementation-level** choices that the
design left open or that are non-obvious from the design alone.

## Context

The workspace starting-state UX moved from "one bundled template + GitHub import"
to "pick-a-lesson modules + GitHub import." First-login template seeding is gone;
the catalog (remote *or* bundled) always fills an empty workspace via a picker.
See `Lessons-Design.md` for the full rationale.

## Implementation decisions

1. **Catalog source path constants.**
   - Host (control plane): the bundled catalog lives at `<repoRoot>/catalog/`
     (`config.catalogDir`, override `LESSONS_CATALOG_DIR`). The manifest service
     reads `catalog/modules.json` from here for the bundled source.
   - Image: the same `catalog/` is copied into the code image at
     **`/opt/frc-catalog/`**. A bundled module load `cp -a`s
     `/opt/frc-catalog/<subdir>/.` into `/workspace/project/` inside the
     container — no network.
   - New config: `catalogRepo` (`LESSONS_CATALOG_REPO`, unset → bundled),
     `catalogBranch` (`LESSONS_CATALOG_BRANCH`, default `main`),
     `catalogDir` (`LESSONS_CATALOG_DIR`, default `<repoRoot>/catalog`).
   - Removed config: `templateDir` / `FRC_TEMPLATE_DIR`.

2. **Bundled demo catalog content.** Ships two modules (D11 / §11): `hello-name`
   (`plain-java`, copied from the lessons repo) and `robot-starter` (`robot`,
   repackaged from the old `templates/wpilib-java-command` WPILib-command starter
   plus a lesson `README.md` and a tiny raw-NT telemetry example). The
   AdvantageKit upgrade of the demo robot module stays deferred (§11): the
   bundled robot demo runs in sim and publishes simple `/SmartDashboard` topics,
   but it is not an AdvantageKit `Logger.recordOutput` example. Production sets
   `LESSONS_CATALOG_REPO` to the full AdvantageKit catalog.

3. **`templates/` is deleted.** It served two roles: first-login seed (removed)
   and Gradle-cache priming in the Docker image. The catalog replaces the first;
   the Dockerfile now primes the Gradle cache from
   `/opt/frc-catalog/modules/robot-starter/` instead of
   `templates/wpilib-java-command/`. `templates/plain-java-hello-name` (the spike
   PoC) is also deleted — `hello-name` now lives in the catalog.

4. **README auto-open is implemented via `workbench.startupEditor: "readme"`**
   (D6), seeded into the per-workspace VS Code *User* settings by the container
   init script, **not** via an editor open-file URL payload. VS Code opens the
   workspace-root `README.md` in Markdown preview when a folder is opened with no
   prior editor state. Because every module load clears the editor's
   `workspaceStorage` (see 5), the folder looks "fresh" on the next open and the
   README preview re-fires — giving exactly the D6 behaviour with no client-side
   command plumbing. No-ops gracefully when a module ships no `README.md`.

5. **`workspaceStorage` is cleared on every destructive project swap.** Module
   load, lesson reset, and team import all `rm -rf /config/data/User/workspaceStorage`
   inside the container before/after replacing `/workspace/project`. This (a)
   stops redhat.java reusing a stale Gradle/invisible-project model across a
   `robot ↔ plain-java` switch on the stable `/workspace/project` URI (§4.3), and
   (b) lets `startupEditor` re-open the new README (4). The rest of `/config`
   (git credentials, editor prefs) is left intact (D5/§5.5).

6. **First-login picker uses a computed `projectEmpty` flag**, not a stored
   "source" column. The session payload exposes `projectEmpty` (host-side
   `readdir(project_path).length === 0`); the web shell auto-opens the Switch
   Project surface when it is `true`. This cleanly distinguishes a brand-new empty
   workspace (auto-open) from a populated team import (don't auto-open) without an
   extra column, since a team import clears `current_module` but leaves files.

7. **Workspace state columns** (`current_module`, `current_module_kind`) are
   added by migration `011_current_module.sql`. `current_module_kind` is captured
   at load time so the layout decision (hide sim chrome for `plain-java`) never
   depends on the manifest being reachable (§5.4). Both are `NULL` for an empty
   workspace and after a team import (a team import renders as `robot`).

8. **Backup/restore is fully removed** (D4): `backupProject`,
   `pruneImportBackups`, `listRecentImports`, `restoreImportBackup`, the
   `/api/project/recent-imports` + `/api/project/restore` routes, the import
   `backup` field, `importBackupMetadataSchema`, the metrics route templates for
   the removed routes, and the web `recentImports`/`restoreBackup` UI. Pure
   discard + git (for team work) is the safety model. The `scripts/backup.ts` /
   `scripts/restore.ts` operator tools (full data-dir backup, unrelated to the
   per-import tarballs) are retained — they are not part of the import flow.

9. **Catalog load reuses the import pipeline** with a `source: "catalog" | "github"`
   distinction (§5.2). Catalog loads skip the `build.gradle` gate and the
   `git init`, keep the size cap, drop any cloned `.git`, and record
   `current_module`/`current_module_kind`. Remote = sparse shallow clone
   (`--depth 1 --filter=blob:none --sparse` + `sparse-checkout set <subdir>`);
   bundled = local `cp` from `/opt/frc-catalog`.

10. **Team import becomes an all-branches shallow clone** (D8): `git clone
    --no-single-branch --depth 1` of the repo root, keeping `.git`/`origin` so
    `git push` works after the student authenticates in the terminal (D13).
    Branch and subdir controls are removed from the student flow and contract.
    Security guards (host allowlist, URL-confusion rejection, 6/hour rate limit,
    size cap, arg-vector exec, path-traversal) are retained; tests gain cases for
    the `--no-single-branch --depth 1` args and the keep-`.git` behaviour.

## Consequences

- Adding/editing production lessons is a commit to the remote lessons repo — no
  image rebuild, no control-plane redeploy. Editing the bundled demo catalog
  ships with the image build.
- The system runs zero-config (bundled catalog) for demos/dev and offline.
- Switching modules discards all uncommitted work by design; students are taught
  to commit/push team work early.
