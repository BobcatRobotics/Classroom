# Lessons & Modules — Design

Status: **Implemented (2026-05).** This document captures the architecture and
user flows for reworking the workspace starting-state UX from "one default
project + GitHub import" into "pick-a-lesson modules + GitHub import." It is the
source of truth for this feature; lesson *content* lives in
[`Lesson-Modules.md`](./Lesson-Modules.md). Implementation-level decisions and
any deviations from this plan are recorded in
[`docs/decisions/029-lessons-and-modules.md`](./docs/decisions/029-lessons-and-modules.md).

Related: [`V2-Design.md`](./V2-Design.md) (system architecture),
[`apps/control/src/imports.ts`](./apps/control/src/imports.ts) (the clone/swap
pipeline we extend), [`docs/decisions/011-v2-editor-spike.md`](./docs/decisions/011-v2-editor-spike.md)
(editor-behavior evidence record).

---

## 1. Goal

Let students pick from a catalog of self-contained **lesson modules**, each a
complete starting project, and work through them at their own pace. Switching
modules resets the workspace (discarding work — this *is* the reset mechanism).
Keep an arbitrary **GitHub import** for build season, where students load the
public team robot repo, authenticate git once in the VS Code terminal when they
need to push, and push their work.

The lesson catalog must be editable **without rebuilding container images or
redeploying the control plane** — for the production (remote) catalog, adding or
editing a module is a commit to a **dedicated public lessons repo**, picked up by
students on their next module load (the remote load always clones the GitHub
remote, never a deployed checkout). The bundled demo catalog is the deliberate
exception: it ships with the build for zero-config use.

The catalog has **two interchangeable sources behind one interface** (D11). When
`LESSONS_CATALOG_REPO` is set, the control plane uses a **remote catalog** (the
dedicated lessons repo over HTTPS). When it is unset, it uses a **bundled
catalog** baked into the app and the code image, so the project runs with **zero
configuration** (for demos and dev) and works offline. Both are real lesson
catalogs surfaced through the same picker and the same module-load flow — there
is no separate legacy seed mode. The bundled catalog ships a small demo set (at
least one `plain-java` and one `robot` module).

### Non-goals

- Saving or migrating student progress *between* modules. Switching discards.
- A new console-run path in the control plane. The app's run/sim behavior is
  unchanged; per-module run differences are handled by what's shipped *inside*
  the module (a `.vscode/launch.json`) and the web shell hiding sim chrome for
  console modules.
- Per-student progress tracking, grading, or lesson sequencing/locking.
- Local git checkpoints inside lesson workspaces. Lessons are **gitless**; the
  only reset path is the app's "Reset this lesson" button (re-load).

---

## 2. Locked decisions

These were decided during planning (2026-05) and drive the rest of the design:

| # | Decision | Choice |
|---|----------|--------|
| D1 | Module hosting | **A dedicated public lessons repo** (e.g. `mathewdunne/coderunner-lessons`), one subdir per module under `modules/`, plus a `modules.json` manifest at the repo root. A separate repo keeps app code and lesson content fully isolated with **no orphan-branch juggling and no CI scoping** to maintain. |
| D2 | Run-mode split | **Keep the app UI as-is; everything is "a robot project" to the app.** Per-module run differences are handled by a shipped `.vscode/launch.json` (console modules) plus the web shell hiding sim chrome — not by changing the control plane. |
| D3 | `.git` handling | **`.git` only for the team import.** The team/arbitrary GitHub import keeps its real `.git`/`origin` so `git push` works. Catalog lessons are **gitless** — no clone history, no `git init`. Reset = re-load via the button (D7/§5.3). |
| D4 | Persistence | **Pure discard on switch/reset.** No tarball backups. The whole backup/restore flow is removed. For team work, git is the safety net (students are taught to commit/push early). |
| D5 | Console-module chrome | **Hide the Driver Station / AdvantageScope panels** for `plain-java` modules, plus a light hint: "Run this lesson from the editor's Run button." |
| D6 | Lesson instructions | **`README.md` inside the project, auto-opened in Markdown preview on module load.** Beginners (esp. module 1) shouldn't have to discover the instructions, so the load flow opens the README preview as the first thing they see (§6). It's still a normal editable file. |
| D7 | First login | **Always show the module picker and auto-open it.** There is always a catalog (remote or bundled — D11), so the workspace starts empty and the student begins by picking a module. No legacy seed-on-first-login mode. |
| D8 | Team project | **GitHub import becomes an all-branches, shallow clone.** `git clone --no-single-branch --depth 1` keeps `.git`/`origin` and makes every remote branch available as `origin/*` (build season needs branches) but drops commit history to save space (history isn't needed — #5). The default branch is checked out; students switch/create branches and push from the VS Code terminal. No forced branch, no subdirectory imports. |
| D9 | Plain-Java modules | Console modules (1–3) **need not ship WPILib/Gradle**; a bare `Main.java` + a simple `java` launch config is preferred. This was proven in the real merged container/browser editor path on 2026-05-29 (§4.3). |
| D10 | Robot module base | **Robot modules start from the official AdvantageKit template zips** (downloaded from [AdvantageKit GitHub releases](https://github.com/Mechanical-Advantage/AdvantageKit/releases) — no hand-maintained base). `AdvantageKit_SkeletonTemplate.zip` for modules 4–8; `AdvantageKit_KitBot2026Template.zip` for modules 9–10. The template wires the `Logger` NT4 publisher in sim mode, so `Logger.recordOutput` renders in the existing HALSim→NT4→AdvantageScope path with no extra setup. Version-pinned and updated manually by re-downloading the zip (track the WPILib season the sim container targets — currently 2026 / AdvantageKit v26.x). |
| D11 | Catalog source | **One `CatalogSource` interface, two implementations.** `LESSONS_CATALOG_REPO` set → **remote catalog** (HTTPS manifest + sparse shallow clone). Unset → **bundled catalog** baked into the app + code image (local manifest + local subdir copy; zero-config/offline). Picker, first-login, load, and reset flows are identical for both. The legacy seed-on-first-login path is **deleted**: `templateDir`/`FRC_TEMPLATE_DIR` and seed-copy logic go away, and `templates/wpilib-java-command` is repurposed as the bundled catalog's demo `robot` module rather than a first-login seed. |
| D12 | Destructive switches | **Stop the active robot run before wiping project files.** Module switch, lesson reset, and GitHub import all stop/disconnect the current run path first, then replace `/workspace/project`. |
| D13 | Git auth | **No server-side credentials.** Imports are public HTTPS clones. For pushing, students authenticate from the VS Code terminal using a PAT/credential helper, or switch the remote to SSH and configure keys if they prefer. |

### Standing assumptions (correct if wrong)

- The **lessons repo and imported robot repos are public**, so the control plane
  never needs a GitHub token or broader OAuth scopes. Student git credentials are
  only for later pushes from the terminal.
- Because lessons live in a separate repo, a `git clone --depth 1` is naturally
  isolated — no app source is involved, and there is no CI to scope or orphan
  branch to maintain.
- Modules always load **latest** from the lessons repo tip. A student mid-lesson
  is not disrupted, because re-fetch only happens on switch/reset.
- The bundled catalog is a real (small) lesson catalog, not a degraded seed: it
  surfaces through the same picker and load flow as the remote catalog. Its demo
  `robot` module should ideally carry AdvantageKit so the sim/AdvantageScope path
  demos well; repackaging `templates/wpilib-java-command` (plain WPILib-command)
  is an acceptable starting point that still runs in sim. Production sets
  `LESSONS_CATALOG_REPO` to point at the full remote catalog.

---

## 3. Pre-implementation state (what changed)

- **Workspace seeding** — `ensureWorkspaceForUser` (`apps/control/src/storage.ts`)
  creates `data/users/<id>/{project,home,logs,assets}` and today seeds `project`
  by copying `config.templateDir` *only if the project dir is empty*. `project`
  is bind-mounted to `/workspace/project` and persists across container restarts.
  **This first-login seeding is removed** (D7/D11): the workspace starts empty and
  the student picks a module. `templateDir`/`FRC_TEMPLATE_DIR` and the seed-copy
  logic are deleted.
- **GitHub import** (`apps/control/src/imports.ts`, driven over `/ws/import`)
  clones inside the container with a shallow, branch-specific clone → **requires
  `build.gradle`** → checks size → **strips `.git/`** → tarball-backs-up the old
  project → wipes `/workspace/project` → copies the clone in. Backups + restore
  exist.
- **Run** is always the robot-sim path: `start-sim.sh` → Gradle sim → HALSim WS
  → NT4 → AdvantageScope + the Driver Station panel. There is **no** console-run
  mode in the app. The whole web shell (editor + ScopePane + DriverStation,
  `apps/web/src/routes/WorkspacePage.tsx`) assumes a robot project.

**Net changes:** first-login template seeding is removed in favor of the picker
(D7/D11); the clone/swap pipeline gains a "load module from catalog" mode (remote
sparse clone *or* bundled local copy) that does **not** require `build.gradle`,
does **not** initialize git, and does **not** back up (D3/D4/D9); the arbitrary
GitHub import becomes an all-branches shallow public clone that keeps `.git`
(D8); the entire backup/restore flow is **removed** (D4); a unified "Switch
Project" surface (lessons + import), reset, README auto-open, and console-mode
panel-hiding appear in the web shell.

---

## 4. Catalog structure (D1)

A **dedicated public lessons repo**. Its tree is *only* the catalog — no app
source — so a shallow clone is small and isolated:

```text
(lessons repo root)
  modules.json                 # the manifest (catalog) — see §4.1
  modules/
    hello-name/                # a "plain-java" module
      .vscode/
        launch.json            # plain java run, integratedTerminal stdin
        settings.json
      README.md                # lesson steps/bonus (D6, auto-opened on load)
      src/Main.java
    closest-distance/          # a "robot" module (from AdvantageKit_SkeletonTemplate.zip)
      .vscode/settings.json
      README.md
      build.gradle             # AdvantageKit vendordep + Logger init, vendor-provided (D10)
      gradlew, gradle/, vendordeps/, src/main/java/...
    ...
```

Each module subdir is a **complete, self-contained starting project**. Robot
modules carry their own gradle wrapper + vendordeps (AdvantageKit included);
plain-Java modules carry just sources and a launch config. The bundled demo
catalog (`catalog/` in the app repo, D11) uses the **identical layout** —
`modules.json` + `modules/<id>/` — so both sources share one load path.

### 4.1 Manifest (`modules.json`)

```jsonc
{
  "schemaVersion": 1,
  "modules": [
    {
      "id": "hello-name",             // stable slug; must equal the subdir name
      "title": "Hello, Name",
      "description": "Variables, println, and reading input from the terminal.",
      "subdir": "modules/hello-name",
      "kind": "plain-java",           // "plain-java" | "robot"
      "order": 10                     // display order; sparse so modules can be inserted
    },
    {
      "id": "closest-distance",
      "title": "Closest Distance",
      "description": "Translation2d math, loops, and logged field outputs.",
      "subdir": "modules/closest-distance",
      "kind": "robot",
      "order": 40
    }
  ]
}
```

Display order is an explicit **`order`** integer (sparse — 10, 20, 30 … — so a
module can be inserted between two others without renumbering). The `id` is a
stable slug that must equal the subdir name and is what `current_module` stores;
it carries **no** ordering meaning, so reordering or inserting never breaks a
student's `current_module` reference. A single field, **`kind`**, captures the
whole run-mode distinction — the two are never independent, so there's no
separate `runVia`:

- **`plain-java`** — a bare Java project, **run from the editor terminal**. Skips
  Gradle/WPILib. The web shell **hides** the Driver Station / AdvantageScope
  panels and shows the D5 hint.
- **`robot`** — a full AdvantageKit/WPILib/Gradle robot project, **run via the
  Driver Station buttons** (the existing HALSim sim path). Normal app chrome.

This is the only field the web shell reads to change layout/affordances.

### 4.2 Per-module run config

- **`plain-java`:** ship `.vscode/launch.json` with a standard Java launch,
  `"console": "integratedTerminal"`, pointed at the module's `main`. The student
  clicks the editor Run button; an interactive terminal opens and accepts
  `Scanner`/stdin input. No Gradle.
- **`robot`:** no special run config required — the student uses the app's Run
  button (existing HALSim sim path). AdvantageKit's `Logger` publishes to NT4,
  which AdvantageScope renders (D10).

### 4.3 Plain-Java spike evidence (D9)

On 2026-05-29, a throwaway `--demo` PoC loaded a hand-made
`hello-name`-style project into a real `coderunner-workspace` container and
was manually verified through the browser-hosted openvscode editor:

- Project shape: `.vscode/launch.json`, `.vscode/settings.json`, `README.md`,
  `src/Main.java`; **no** `build.gradle`, `gradlew`, WPILib, or Gradle wrapper.
- Launch config: Java debug launch with `"type": "java"`,
  `"request": "launch"`, `"mainClass": "Main"`, `"cwd": "${workspaceFolder}"`,
  and `"console": "integratedTerminal"`.
- Java settings: `"java.project.sourcePaths": ["src"]`,
  `"java.project.outputPath": "bin"`, empty referenced libraries, Gradle
  auto-detect/build-server disabled, and Java debug console set to
  `integratedTerminal`.
- Result: redhat.java / vscode-java-debug compiled and launched `Main.java`
  from the editor Run action, opened an integrated terminal in the browser, and
  accepted interactive `Scanner` stdin as expected.

Important boundaries from the spike:

- The container init script currently logs a warning when `/workspace/project`
  lacks `build.gradle` or `gradlew`. It is harmless for `plain-java` modules, but
  the warning should be removed or made conditional before lesson mode is
  considered polished.
- The spike proved a fresh plain-Java workspace. L-7 should also explicitly test
  robot → plain-java → robot switching in one persisted workspace, because VS
  Code/JDT state is keyed to the stable `/workspace/project` folder. If stale
  project-model state appears, clear only the editor workspace cache
  (`/config/data/User/workspaceStorage` / host `home/data/User/workspaceStorage`)
  as part of destructive module switches; do **not** wipe the whole home dir,
  because git credentials and other student editor state live there.

---

## 5. Control-plane design

### 5.1 Catalog manifest service

A small module-catalog service in the control plane behind one `CatalogSource`
interface (D11), so the picker, load, and reset flows don't care which source is
active:

- `GET /u/:slug/api/lessons` (authenticated, workspace-owned) → returns the
  parsed `modules.json` for the picker. It **always** returns a catalog (remote
  or bundled); there is no "not configured" state.
- **Remote source** (`LESSONS_CATALOG_REPO` set): fetch
  `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/modules.json` over
  HTTPS with a **short in-memory cache** (~60s TTL) so edits show up quickly but
  a class refreshing the picker doesn't hammer GitHub. (Real propagation is also
  bounded by GitHub's raw CDN TTL.) On fetch failure, serve the last-good cached
  manifest; if there is none, return an error state in the picker.
- **Bundled source** (`LESSONS_CATALOG_REPO` unset): read `modules.json` from the
  catalog directory baked into the app (`catalog/` in the repo). No network, no
  cache needed, never fails. The same `catalog/` is copied into the code image at
  build time so the load step can copy module subdirs locally (§5.2).
- Config: `LESSONS_CATALOG_REPO` (no default → bundled source);
  `LESSONS_CATALOG_BRANCH` (default `main`, remote source only).

### 5.2 Module load (extends the import pipeline)

Reuse the `ImportManager` clone/swap machinery (`imports.ts`) with a
**`source: "catalog" | "github"`** distinction. New entrypoint
`POST /u/:slug/api/lessons/load` + `/u/:slug/ws/lesson-load` (mirrors
`/ws/import` streaming), body `{ moduleId }`. Steps for a catalog load:

1. Resolve `moduleId` against the manifest (cached remote, or bundled) → get
   `subdir`, `kind`.
2. Ensure the container is running.
3. Stop any active robot run and disconnect HALSim/NT4/gamepad state before
   touching files.
4. **(Confirmation happens client-side before this call — see §6.)**
5. Materialize the module subdir into a staging dir:
   - **Remote source:** **sparse shallow clone** —
     `git clone --depth 1 --filter=blob:none --sparse --branch <branch>` then
     `git sparse-checkout set <subdir>`, so only that module is pulled (not the
     whole catalog — #6/§11), reusing the existing import mechanism.
   - **Bundled source:** copy `catalog/<subdir>` from the in-image catalog path
     (baked in at build time). No network.
6. **No `build.gradle` requirement** for catalog modules — the catalog is
   author-trusted; validate only that `subdir` exists and is non-empty. **Keep
   the size cap** as cheap insurance against an accidentally-committed large file.
7. **No tarball backup** (D4). Wipe `/workspace/project` contents and copy the
   module subdir in.
8. **No `.git`** (D3). Any cloned `.git` is dropped along with the staging dir;
   nothing is `git init`-ed in `/workspace/project`. Lessons are gitless — reset
   is the button (re-load), not local git.
9. If switching project kind, consider clearing the VS Code workspace cache
   (`/config/data/User/workspaceStorage`) so redhat.java does not reuse a stale
   Gradle/invisible-project model for the stable `/workspace/project` URI. Keep
   the rest of `/config` intact.
10. `lsiown -R abc:abc /workspace/project`, clean up staging.
11. Record the loaded module id **and its `kind`** on the workspace row (§5.4).

### 5.3 `.git` handling (D3)

- **Catalog module:** gitless. No `.git`, no `git init`. Students restart a
  lesson with the **"Reset this lesson"** button, which re-loads the module
  (latest from catalog — §5.4). Pushing is not expected for lessons.
- **Team project / arbitrary GitHub import (standalone repo):** clone the public
  repository root with `git clone --no-single-branch --depth 1` (no `--branch`,
  no subdirectory copy): every remote branch is fetched as `origin/*` (build
  season needs branches) but only at depth 1 (no history, smaller — #5). Keep the
  real cloned `.git`, including the HTTPS `origin`, so `git push` of new commits
  works after the student authenticates (pushing commits that descend from the
  shallow tip is fine; a student can `git fetch --unshallow` from the terminal in
  the rare case they need full history). The default branch is checked out;
  students create/switch local branches in the terminal. This path **retains** the
  `build.gradle` validation (a team import is always a robot project), the size
  cap, and the existing GitHub host/rate-limit guards.

### 5.4 Workspace state

Add two nullable columns to `workspaces` (new migration):

- `current_module` TEXT NULL — the catalog `moduleId` currently loaded (NULL for
  a fresh/empty workspace or after a team import).
- `current_module_kind` TEXT NULL — the module's `kind` (`plain-java` | `robot`)
  **captured at load time** (#4). NULL for an empty workspace or a team import
  (which is always treated as `robot`).

Used to: render the picker's "current lesson" highlight; power the **Reset this
lesson** action (re-run §5.2 for the same `moduleId` — this fetches the
**latest** version from the catalog, by design); and decide whether to hide the
sim chrome. Storing `current_module_kind` means the **layout decision never
depends on the manifest being reachable** — no render-time refetch, no
"guess robot if the manifest is down" path. The web shell reads `current_module`
+ `current_module_kind` from the session/status payload. An empty workspace or a
team import (both NULL kind) renders as a normal `robot` project so the full app
chrome is available.

### 5.5 Persistence & discard (D4)

- Switching, resetting, or GitHub-importing first stops any active run, then
  wipes `/workspace/project` and reloads. No backups.
- The student `home` dir bind-mount is **untouched** by module loads, so git
  credentials stored there (`git config --global credential.helper store`)
  survive across module switches — the one-off build-season auth stays valid.
- The tarball **backup/restore flow is removed entirely** — it was built
  speculatively, restoring was never an obvious flow, and pure-discard + git
  (for team work) covers the safety need. Delete all of it: `backupProject`,
  `pruneImportBackups`, `listRecentImports`, `restoreImportBackup`, the
  `/api/project/recent-imports` and `/api/project/restore` routes, the `backup`
  field on the import request, `importBackupMetadataSchema`, and the web-side
  `recentImports` / `restoreBackup` / backup UI in `useImport` + `ImportDialog`.

---

## 6. Web shell changes

- **"Switch Project" button (top bar)** — a single entry point that opens a
  dialog/overlay with **both** paths:
  1. **Lessons** — the module catalog from `GET /u/:slug/api/lessons` (ordered
     by the manifest `order` field), each tile showing title + description and a
     "Load" action. Always present (remote or bundled catalog — D11).
  2. **Import from GitHub** — a URL field for loading a public team/robot repo
     root (build-season path, keeps `.git`; push auth happens later in the
     terminal).

  Both paths are "switch project" operations: they discard the current workspace
  and load new content, behind the same confirmation. The GitHub import is
  **moved out of the `UserMenu`** — `ImportDialog` is folded into this surface
  and the `UserMenu` import entry is removed.
- **First login (D7)** — empty workspace; auto-open the Switch Project surface so
  the student starts by picking a lesson (or importing). Same for both catalog
  sources — there is no legacy seed path.
- **README auto-open (D6)** — after a successful module load, the web shell opens
  the module's `README.md` in **Markdown preview** in the editor (via the editor
  open-file URL / a post-load open command), so instructions are the first thing
  a student sees. No-op gracefully if the file is absent.
- **Switch/Reset confirmation (D4)** — loading a different module/repo, or
  "Reset this lesson," shows a simple: *"This will discard any changes in your
  workspace. Continue?"* — the same dialog for lessons and team import. (Students
  are taught git early and are expected to commit/push team work, so no stronger
  guard is needed.) Reset re-loads `current_module` (latest from catalog).
- **Console-module chrome (D5)** — when the loaded module's `kind`
  (`current_module_kind`, §5.4) is `plain-java`, **hide** the Driver Station /
  AdvantageScope panels and show a
  light hint near the Run controls: *"Run this lesson from the editor's Run
  button."* Hiding must also **gate the sim data hooks**, not just stop
  rendering: the sim hooks (`useSimulationState`, `useRunChannel`,
  `useAutoChoosers`, `useScopeHandshake`, `useGamepadChannel`) are called at the
  `WorkspacePage` level, *above* the panels, so an unrendered panel still leaves
  their polls/WebSockets open. They already no-op on a `null` slug, so pass
  `kind === "robot" ? workspaceSlug : null` in console mode — this stops the two
  1 s `GET /api/sim/*` polls and the idle HALSim/run WebSockets per student. (The
  ScopePane NT4 socket lives in the iframe and closes for free when the panel is
  unmounted.)
- **Instructions (D6)** — the module ships `README.md`, auto-opened in Markdown
  preview after load (see "README auto-open" above). Students can close it and
  re-open from the explorer like any file.

---

## 7. Contracts changes (`packages/contracts`)

- Add `lessonModuleSchema` + `lessonCatalogSchema` (the §4.1 manifest shape:
  `id`, `title`, `description`, `subdir`, `kind`, `order`; no tags, progress, or
  prerequisite fields).
- Add `lessonLoadRequestSchema` (`{ moduleId }`) and reuse the existing
  `importServerMessage` discriminated union for streamed progress.
- Add `current_module` + `current_module_kind` to the session/status payload
  schema the web shell reads (§5.4).
- Remove `importBackupMetadataSchema` and the `backup` field on
  `importRequestSchema` (backup flow deleted — §5.5).
- Remove `branch` and `subdir` from the student-facing GitHub import contract.
  The supported import shape is a public GitHub repository root URL.

---

## 8. Security

- **Remote catalog loads** use control-plane-configured URLs (trusted), so SSRF
  risk is low; still run the clone inside the container as today, and keep the
  size cap. **Bundled catalog loads** touch no network (local copy from the
  in-image `catalog/`).
- **Arbitrary GitHub import** remains public-GitHub-only and keeps the important
  existing guards: GitHub host allowlist, URL-confusion rejection, the 6/hour
  rate limit, size cap, command-argument execution, and path-traversal checks
  (`__tests__/security/*`, `__tests__/property/imports-url.property.test.ts`).
  Branch/subdir import is removed from the student flow because the build-season
  path is an all-branches `--depth 1` clone with `.git` preserved. Tests must gain
  cases for the `--no-single-branch --depth 1` args and the keep-`.git` behavior.
- The lessons repo and imported robot repos are **public**, so there's no secret
  handling — the control plane reads the manifest and clones over HTTPS.

---

## 9. Module authoring workflow (for the maintainer)

The lessons repo is a normal, separate repo — no orphan branch, no worktree
juggling, and no CI scoping (it has no app CI):

1. Add `modules/<id>/` with a complete starting project, a `README.md`, and (for
   `plain-java`) a `.vscode/launch.json`. Robot modules start from an unzipped
   official AdvantageKit template (skeleton for 4–8, KitBot for 9–10 — D10).
2. Add an entry to `modules.json` (set `order`; use sparse values like 10/20/30
   so later inserts don't force renumbering).
3. Commit/push to the **remote** lessons repo. No image rebuild and no
   control-plane redeploy. Students pick it up on their next module load (manifest
   cache expires within ~60s). The **bundled** demo catalog (`catalog/` in the app
   repo) is the exception: editing it ships with the app/image build, not at
   runtime.

To bump the AdvantageKit version, re-download the relevant template zip from the
AdvantageKit releases, re-apply it under each robot module (carrying lesson code
forward), and verify a sim run still publishes to AdvantageScope. Keep the
template's WPILib/AdvantageKit season aligned with the sim container's GradleRIO
version.

---

## 10. Phased implementation plan

Each phase ends with a green `bun run verify` and updated tests.

- **L-0 — Strip backups + remove first-login seeding.** Remove the entire
  backup/restore flow (control plane, contracts, web). Delete the first-login
  template-seed path (`templateDir`/`FRC_TEMPLATE_DIR`, seed-copy); the workspace
  starts empty (the picker fills it in L-4). Keep `templates/wpilib-java-command`
  on disk for now — it becomes the bundled catalog's demo `robot` module in L-1.
- **L-1 — Catalog sources + manifest.** Define the `CatalogSource` interface and
  both implementations: the dedicated public **remote** lessons repo, plus the
  **bundled** `catalog/` in the app repo (baked into the code image) seeded with a
  small demo set — one `plain-java` module and one `robot` module (repackage
  `templates/wpilib-java-command` to start). Define the `modules.json` schema
  (incl. `order`).
- **L-2 — Contracts + manifest service.** Add lesson schemas (incl. `order`) and
  the `current_module`/`current_module_kind` session-payload fields;
  `GET /u/:slug/api/lessons` behind `CatalogSource` (remote: cached HTTPS fetch +
  last-good fallback; bundled: local read). Always returns a catalog.
- **L-3 — Module load pipeline.** Extend `imports.ts` with the catalog source:
  stop active run, sparse shallow clone (remote) or local copy (bundled), copy
  subdir, size cap, no gradle gate, no `.git` init, `current_module` +
  `current_module_kind` tracking, `/ws/lesson-load` streaming.
- **L-4 — Web shell.** "Switch Project" top-bar surface (lessons + import),
  auto-open picker on first login, README auto-open after load, simple
  switch/reset confirmation, hide sim chrome for `plain-java` *and* gate the sim
  hooks via a `null` slug (§6); remove import from `UserMenu`.
- **L-5 — Team import becomes all-branches shallow clone.** Remove branch/subdir
  controls, clone public repo roots with `--no-single-branch --depth 1`, keep
  `.git`, clear `current_module`/`current_module_kind`, verify commit/push works
  after terminal auth, and update security tests for the all-branches `--depth 1`
  / keep-`.git` path.
- **L-6 — Author the full module set** from `Lesson-Modules.md` (10 modules;
  robot modules built on the AdvantageKit skeleton/KitBot template zips). Module
  6 is a placeholder pending author-provided content.
- **L-7 — Acceptance pass.** Login → pick module → run (both paths) →
  `Scanner` stdin in a `plain-java` integrated terminal → robot/plain-java/robot
  switching in one persisted workspace → switch/reset discards → team import →
  commit & push.

---

## 11. Deferred / future optimizations

No open questions remain. Decisions intentionally left for later:

- **Clone strategy (resolved → sparse shallow clone of the lessons repo).** Remote
  module loads use `git clone --depth 1 --filter=blob:none --sparse` +
  `sparse-checkout set <subdir>`, so only the one module is materialized (not the
  whole catalog), reusing the existing import path. History is discarded. Bundled
  loads copy locally with no clone at all.
- **Server-side catalog mirror (deferred — not worth it at current scale).** With
  sparse checkout pulling only one module, a per-container fetch on each switch is
  cheap at the 30-student ceiling. If the catalog ever grows large enough that
  this becomes a real cost, clone/mirror the catalog once on the host, `git fetch`
  periodically, and copy the subdir into containers.
- **Bundled demo `robot` module upgrade (deferred).** L-1 ships the repackaged
  `templates/wpilib-java-command` (plain WPILib-command) as the demo robot module
  to get the bundled catalog working. It runs in sim and publishes a tiny raw-NT
  `/SmartDashboard` telemetry example, but it has no `Logger.recordOutput`.
  Replace it later with a minimal AdvantageKit module so the bundled demo matches
  the production lesson style.
