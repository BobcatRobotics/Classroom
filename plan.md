# Local-First CodeRunner Plan

## Goal

Run each student's editor, Java toolchain, WPILib tools, and simulator on the
student's own Windows or macOS laptop. Keep identity, roster, lessons,
assignments, progress, and submitted work centralized. Reduce cloud cost by
avoiding always-available per-student workspace containers.

Students are expected to have internet access while using CodeRunner. Local
project files persist on their computer; this is not intended to be a fully
offline product.

## Current and Target Models

### Current

The central control plane authenticates students, owns project directories,
and starts/stops workspace containers on the server. `workspace-template` is a
one-shot helper that pulls the shared workspace image onto that server. The
operator's `rebuild-workspaces` command force-removes all managed workspace
containers, including stopped ones, clears container leases, and relies on the
external project and editor-home directories to preserve student data.

### Target

The central service remains responsible for accounts, lessons, assignments,
progress, and submissions. A local launcher manages Docker and a workspace
container on each student's computer. It stores project files outside the
container, so replacing a container or image does not delete student work.

`workspace-template` will not update laptop images. The launcher must check
CodeRunner's release metadata, download approved workspace-image versions, and
recreate the local container when an update is appropriate.

### Central Data Ownership

Pulling or updating a workspace image changes no central student records. The
control-plane release owns schema migrations; image releases only change the
local runtime/toolchain.

- `workspaces` remains the central logical student-workspace record, but its
      current `project_path` points to server-hosted files. Decide how to represent
      local projects without treating a laptop path as a server path.
- `container_leases` describes containers managed by the server. Do not create
      fake leases for laptop containers. Keep it for hosted workspaces during any
      transition; add separate device/runtime status only if central visibility is
      needed.
- `run_jobs` is currently written by the server-side run manager. Local runs
      will not appear there unless the launcher reports run events/results through
      authenticated APIs or the server independently runs/verifies the work.
- `lesson_completions` currently depends on a qualifying `run_jobs` record
      with successful build/tests. Define whether local-reported results are
      student-declared or server-verified before using them to create completions.
- Keep assignment submissions distinct from lesson completions; a submitted
      project snapshot is not itself proof that a lesson's build/tests passed.

## Decisions and Constraints

- Students sign in with their GitHub account through central CodeRunner.
- The allowlist/roster check is intended for initial account creation. Define a
  separate account-disable/revocation action for students who should lose
  access after account creation; allowlist removal alone will not revoke an
  already-created account under this policy.
- Do not require students to configure environment variables or type Docker
  commands.
- Do not put OAuth client secrets or shared credentials in the launcher or
  workspace image. Use central browser sign-in and a short-lived, one-use
  pairing code to link the launcher, then store its revocable device credential
  in the operating system's credential store.
- Local use and all central services require internet connectivity. The server
  can deny future launches or sync after account/device revocation; an already
  running local process cannot be remotely stopped while disconnected.
- A Docker image can be copied after download. Access control must protect
  central services and require valid authorization for normal launcher use; do
  not treat private image distribution as the authorization boundary.
- Target student platforms are Windows and macOS. Some students may need parent
  approval or assistance to install Docker Desktop. The launcher must explain
  permission problems and provide a supported help/fallback path, not bypass
  device restrictions.
- Publish immutable workspace image versions/digests. Do not depend on `latest`
  for student update decisions.

### Application and Repository Boundaries

- Keep the hosted/local browser shell, desktop client, local runtime, central
      services, and workspace image as distinct components even while they live in
      one repository. Docker image work does not require moving the client to a
      separate repository.
- `apps/web` owns the React student shell. It may be served by the central
      control plane or bundled as a static build artifact for local use; it does
      not own desktop lifecycle, installer, or Docker-management behavior.
- `apps/launcher` owns desktop-window integration, first-run/setup UX, OS
      integration, and installer concerns. It starts and supervises the local
      runtime through an explicit process/API boundary rather than owning Docker
      orchestration or importing control-plane internals.
- The local runtime owns loopback HTTP/WebSocket APIs, Docker lifecycle, local
      project and editor-state paths, and proxying to the workspace container. Keep
      its local API distinct from central account/catalog/submission APIs.
- `packages/contracts` (or a later dedicated shared package) is the deliberate
      home for dependency-neutral schemas shared across these boundaries. Avoid
      direct source imports between app directories; use shared packages, explicit
      APIs, or build artifacts instead.
- Keep client, central control plane, and workspace image independently
      buildable and versionable. Record their compatibility requirements at their
      interfaces; do not make a client release implicitly require a workspace
      image rebuild, or vice versa.
- Keep the current monorepo/workspace while these boundaries evolve. Consider
      a separate client repository only when it can build, test, and package from
      declared/versioned dependencies without reaching into `apps/web` or
      `apps/control` source. Until then, keep repository extraction as a later
      packaging decision, not a prerequisite for client work.

## Phases

### Phase 1: Local Runtime Prototype

- [ ] Run the current workspace image locally on representative Windows and
      macOS laptops. (Mac ARM64 prototype run completed; Windows remains.)
- [x] Keep the project directory in persistent host storage outside the
      container; keep editor state separate from project files. (Verified across
      container removal and recreation on Mac.)
- [x] Bind editor and simulator ports to localhost only. (Verified all three
      published ports use `127.0.0.1` on Mac.)
- [x] Verify Gradle tests/build and headless simulation, including HALSim and
      NT4 startup, on the local image.
- [x] Verify project and editor state survive container removal/recreation, and
      the editor becomes ready afterward. (The immediate post-recreation probe
      raced startup; the readiness retry returned HTTP 200.)
- [x] Verify the workspace Java language service reaches `Java: Ready` on JDK
      25 and plain-Java `Run Main` succeeds in the browser editor. This checks
      the container runtime only; the Mac host JDK is not part of the check.
- [ ] Verify an edit made in the browser editor is saved to the host-mounted
      project directory.
- [ ] Verify **WPILib: Build Robot Code** through the editor. The real-image
      smoke observed Java 25 and successful Gradle output, but timed out waiting
      for its expected editor-command evidence; distinguish an evidence
      collector mismatch from an actual editor build failure.
- [x] Replace the container with a different image version and verify the
      host-mounted project survives. Tested `v2027.0.6` then `v2027.0.7` using
      the same project/config directories; both reached HTTP 200 and saw the
      persistence marker.
- [x] Verify rollback to a previous image version after a newer image has run.
      Recreated a disposable `v2027.0.7` workspace as `v2027.0.6`; it reached
      HTTP 200 and retained the host-mounted project marker.
- [ ] Measure actual RAM, disk use, first image download time, and filesystem
      performance on Docker Desktop. Mac ARM64 observations: image about
      2.64 GB; idle use about 110 MiB; project 225 MiB; editor/Gradle state
      1.2 GiB; host had 13 GiB free. A 256 MiB sequential bind-mount write
      measured about 841 MB/s. Pulling `v2027.0.6` took 80 seconds with most
      layers already cached, so a cold first-pull time remains unknown.
- [ ] Identify supported OS versions, minimum device resources, and Docker
      installation permissions. Prototype host: macOS 27.0.1, ARM64, 18 GiB
      physical RAM; Windows, minimum requirements, and install permissions
      remain untested.
- [ ] Define and validate feature parity with the hosted student experience.
      The workspace image alone starts VSCodium; it does not provide the web
      shell/control-plane surfaces. The local experience must account for
      project/lesson switching, Run/build feedback and logs, Driver Station
      controls, AdvantageScope telemetry, PathPlanner file access, and Project
      Preview. Identify the local shell/runtime service that supplies those
      surfaces, while keeping sign-in, roster, lesson/assignment catalog,
      progress, and submissions connected to central services. Do not treat a
      directly opened editor as feature-complete.

**Exit criteria:** The local workspace runtime supports representative
edit/build/simulation work on the supported laptop targets, and replacing or
restarting its container preserves the project. The feature inventory names the
hosted-browser capabilities the local shell must provide and assigns each gap
to an implementation phase; building that shell is Phase 2.

### Phase 2: Local Shell and First-Run Launcher

The launcher must start the CodeRunner student experience, not just the
workspace image's VSCodium page. Build and validate the local runtime/shell
boundary before investing in signed installers.

#### 2A: Local Shell and Runtime Spike

- [x] Choose the Phase 2 prototype UI delivery: the existing Bun/TypeScript
      control plane serves the existing React shell on loopback and connects to
      Docker in local port mode. This keeps the hosted student UI and its APIs
      instead of opening VSCodium directly. The eventual signed launcher may
      open a browser or wrap this local shell in a desktop webview; decide that
      after usability testing.
- [x] Reuse the existing local service contract for workspace readiness,
      Run/build output, simulator state and commands, and project-file APIs.
      The control plane is loopback-only; Docker control and project paths are
      not exposed to the network.
- [x] Build a Mac vertical slice using `bun run dev:local`: it serves the local
      CodeRunner shell, starts the pinned workspace image, and keeps its demo
      data under `data/local-phase2/`.
- [ ] Document and maintain the ownership/API boundary between `apps/web`, the
      desktop client, the local runtime, central services, shared contracts,
      and the workspace image. Keep cross-component dependencies on explicit
      APIs, shared packages, or build artifacts rather than app-source imports.
- [x] Verify the local Run path builds and starts `robot-starter`; Gradle tests
      passed, HALSim connected, NT4 health returned HTTP 200, and a Driver
      Station enable command changed simulator state. The first repeated run
      hit OOM kills at 3 GiB; the local prototype now uses a 4 GiB cap.
- [x] Exercise Start, Stop, Restart, and Driver Station enable/disable from the
      browser. Restart completed with `BUILD SUCCESSFUL`, HALSim reconnected,
      and the run returned to `running` at 4 GiB; cgroup reported zero OOM kills
      and peak observed use was about 3.45 GiB.
- [x] Verify the local shell can load the AdvantageScope, PathPlanner, and
      Preview panes, serves their local routes/APIs, and opens Switch project.
      AdvantageScope connected to the robot's NT4 server.
- [ ] Verify live robot telemetry is rendered in AdvantageScope. The robot
      sim and NT4 clients connected, but AdvantageScope stopped at its first-run
      beta acknowledgement, which requires explicit user consent.
- [x] Exercise PathPlanner read/write behavior through its UI. Its first load
      read the project snapshot and wrote `navgrid.json`; the file appeared in
      the host project before the confirmed project replacement removed it.
- [x] Verify edits made in the browser editor persist in the host project
      directory. A browser-created marker was read back from the host bind mount.
- [x] Verify selecting/replacing a project through Switch project and confirm
      the prompt/preservation behavior against local storage. Back retained the
      marker; Continue displayed the warning and replaced the host project.
- [x] Record feature parity by workflow and explicitly track any accepted
      differences from the hosted experience. A directly opened editor is not
      an acceptable substitute. The workflow inventory and remaining validation
      are recorded in `docs/development/dev-servers.md`.

#### 2B: Guided Runtime Setup

- [x] Detect whether Docker Desktop is installed, running, and usable on each
      supported OS/architecture; explain permission and resource failures and
      provide an approved help/fallback path. The prototype supports macOS
      (Apple silicon/Intel) and Windows x64; Docker reports its Desktop engine.
      Windows remains untested on a physical device.
- [x] Pull an immutable, pinned workspace image; create separate persistent
      project and editor/config storage; bind required ports to laptop loopback;
      start the container and wait for readiness. Verified with a live Mac
      startup; all published ports bound to `127.0.0.1`.
- [x] Make install, launch, restart, and repair idempotent. Setup/repair are
      repeatable; closing and relaunching adopted the existing container and
      preserved its project. Image pull progress, low-disk/Docker errors,
      control-port fallback, and startup timeout guidance are implemented.
- [x] Collect support diagnostics without credentials, project contents, or
      other sensitive user data.
- [x] Define whether closing the launcher stops or leaves the workspace running,
      and make that behavior visible and recoverable. Closing the source
      launcher stops the control service but leaves the container/data; a later
      launch adopts it.

#### 2C: Packaging and Recovery

- [x] Select Electron and Electron Builder for desktop packaging after the
      local shell spike. The current Mac ARM64 build produced unsigned ZIP and
      DMG artifacts; signing/notarization and Windows release builds remain
      separate validation.
- [x] Build the unsigned macOS ARM64 package on Apple silicon. `bun run
      desktop:build` produced both ZIP and DMG artifacts from the current
      checkout.
- [ ] Build the unsigned macOS x64 package on an Intel Mac. This produces ZIP
      and DMG artifacts; validate that the packaged app launches.
- [ ] Build the unsigned Windows x64 package on a Windows x64 machine. This
      produces the NSIS EXE; validate that the packaged app launches. Code
      signing and notarization are deferred to Phase 8.
- [x] Verify the client, local runtime, web-shell artifact, and workspace image
      have explicit build inputs and compatibility boundaries. Documented the
      desktop build/test/package entrypoints, bundled inputs, current
      source-tree coupling, and pinned image/runtime pairing in
      `docs/development/dev-servers.md`. Keep them in this monorepo unless
      independent releases make extraction worthwhile.
- [x] Build the desktop web-shell artifact from the current checkout instead of
      replacing it with the latest published web bundle. The macOS ARM64
      packaging pipeline completed with this behavior.
- [ ] On disposable macOS and Windows user profiles, test install, launch,
      restart, repair, uninstall, and reinstall. Verify the project and
      editor/config state survive and reinstall adopts the existing workspace.
      Windows uses the NSIS uninstaller; macOS removes the app bundle after
      quitting. Record that uninstall currently leaves Docker workspace
      resources in place and may leave the container running. Any later full
      cleanup must be a separate, clearly scoped, explicit action that warns
      before deleting student project data.
- [ ] Test interrupted image pulls, failed startup, low disk, port conflicts,
      Docker unavailable, and recovery without losing project or editor state.
      Unit tests cover Docker unavailable, low disk, port selection, and failed
      image-download retry with project preservation (`bun test
      apps/launcher/runtime/local-setup.test.ts`); on-device recovery scenarios
      remain to be exercised.

**Exit criteria:** A student can install and launch a local CodeRunner
experience without manual environment configuration or Docker commands. The
local shell supports the required hosted-browser runtime workflows, Docker and
startup failures have actionable recovery, and restarting or uninstalling does
not silently delete project data. Unsigned packages may be used for the
controlled pilot if participants can complete the OS warning flow and school
device policy permits it. Central sign-in, catalogs, assignments, and
submissions remain assigned to their later phases.

Phase 3 implementation may proceed while unsigned package and on-device
recovery validation continue. Do not begin the two-student pilot until install
and recovery have been validated on macOS and Windows and the central account,
pairing, and student workflows needed by the pilot are available.

### Phase 3: Central Account and Device Linking

- [ ] Keep GitHub OAuth and initial roster/allowlist validation on the central
      CodeRunner site.
- [ ] Create the student's CodeRunner account and workspace metadata centrally
      on their first successful allowed GitHub sign-in.
- [ ] Define the central `workspaces` record's role when the project exists
      only on the student's device; never store a laptop filesystem path as a
      server path.
- [ ] Keep `container_leases` limited to server-managed containers. Decide
      separately whether to add a device record for linked launcher/version/
      last-seen/revocation status.
- [ ] Add a short-lived, single-use pairing code generated by the signed-in
      central site and entered into the local launcher.
- [ ] Exchange the code for a revocable device credential; store it in the OS
      credential store, not in the image, project, or logs.
- [ ] Require online authorization for normal launcher use and central API
      access.
- [ ] Add an explicit account-disable and device-revocation flow for roster
      changes after first account creation.
- [ ] Test pairing expiry, replay, lost devices, account disablement, and
      credential revocation.

**Exit criteria:** The server can associate a local installation with the
centrally authenticated student and deny future service after revocation.

### Phase 4: Central Lessons and Assignment Delivery

- [ ] Expose lesson and assignment catalogs with stable version identifiers.
- [ ] Let the launcher retrieve the selected lesson/project into local storage.
- [ ] Track centrally which student opened which assignment version.
- [ ] Ensure changing assignments prompts before replacing existing project
      files.
- [ ] Define how centrally authored lesson changes reach students and whether
      already-started assignments stay pinned to their original version.

**Exit criteria:** Students can select an assignment centrally and work on its
project locally without losing work when lesson definitions change.

### Phase 5: Completion and Submission Sync

- [ ] Add an explicit Mark Complete/Submit action.
- [ ] Upload a versioned project snapshot and file manifest over the student's
      authenticated connection.
- [ ] Make uploads retryable, resumable, and safe to repeat after a timeout.
- [ ] Show pending, synced, and failed states in the student experience.
- [ ] Exclude editor settings, Gradle caches, extensions, and other regenerable
      machine state.
- [ ] Enforce archive size, file-count, path, and extraction-safety limits.
- [ ] Record student, assignment/version, workspace-image version, timestamp,
      and submission status.
- [ ] Define authenticated APIs for local run events/results. Decide which
      fields may populate `run_jobs` and how to distinguish client-reported
      results from server-verified results.
- [ ] Preserve the current rule that `lesson_completions` requires qualifying
      run evidence, or explicitly redesign that rule for local execution.
- [ ] Decide whether completion is student-declared or requires server-side
      build/test verification.

**Exit criteria:** A student can submit reliably and staff can inspect the
correct centrally stored submission and its status.

### Phase 6: Workspace Image and Launcher Updates

- [ ] Publish immutable workspace-image versions and a signed release manifest
      containing the supported image digest and minimum launcher version.
- [ ] Keep launcher, workspace-image, and central control-plane releases
      independently versioned.
- [ ] Have the launcher periodically check the manifest and show an update
      notice; defer non-critical updates during active assignments.
- [ ] On approval or a safe lifecycle boundary, pull the new image, stop and
      recreate the local container, and reattach persistent project storage.
- [ ] Preserve the prior image for rollback; clean old images only through an
      explicit disk-space policy.
- [ ] Test interrupted pulls, low disk space, failed startup, rollback, and
      incompatible project/toolchain versions.
- [ ] Document that central `docker compose pull` and
      `coderunner rebuild-workspaces` do not update student laptops.
- [ ] Verify image pulls/replacements do not mutate `workspaces`,
      `container_leases`, `run_jobs`, or `lesson_completions`; only explicit
      authenticated workflow APIs should change student/activity records.

**Exit criteria:** Workspace image updates are observable and recoverable, do
not erase projects, and do not unexpectedly interrupt active work.

### Phase 7: Pilot and Migration

- [ ] Begin with a two-student pilot: one macOS device and one Windows device.
      Use unsigned packages only with informed participants and after confirming
      school/family device policy allows installation; expect OS publisher or
      download warnings. Include students with parent-imposed installation
      restrictions in later pilot expansion.
- [ ] Test install, GitHub sign-in, roster rejection, pairing, lesson load,
      submit, update, uninstall, reinstall, and recovery from failed sync.
- [ ] Provide a support/fallback path for devices where Docker cannot be
      installed or run.
- [ ] Define transition for projects currently stored on the server: export or
      download each project and verify it is present locally before retiring
      its server workspace.
- [ ] Track setup completion, support burden, submission reliability, actual
      cloud resource reduction, and network/image-pull impact.

**Exit criteria:** Students can complete the full workflow on supported
personal devices, with a documented exception path and verified project
migration. This phase authorizes a limited pilot only; it does not authorize
class-wide distribution.

### Phase 8: Signed Release and General Rollout

- [ ] Build and validate signed Windows x64 installers and signed/notarized
      macOS arm64/x64 installers on their supported build hosts. Keep signing
      credentials in the release secret store, never in the repository.
- [ ] Confirm the signed artifacts install without unknown-publisher or
      unnotarized-app warnings on clean supported devices.
- [ ] Complete any school or platform distribution-policy review and publish
      the supported install instructions.
- [ ] Roll out by class only after the pilot exit criteria and signed-release
      checks are met.

Code signing is not generally a legal prerequisite for distributing desktop
software, but operating systems and managed-device policies may warn or block
unsigned apps. Signed releases are required here before broad classroom rollout
to reduce installation friction and establish publisher identity.

## Release and Update Responsibilities

### Central control-plane-only changes

Changes to central auth, roster management, lesson APIs, assignment tracking,
submission handling, or web UI deploy with the central control plane. Students
receive these features when they next connect. A central deployment does not
replace the local workspace image.

### Workspace-image changes

Changes to the editor base, JDK, WPILib extensions/tools, simulator scripts,
container startup, or bundled catalog require a new workspace image release.
The central release manifest announces it; each launcher pulls and applies it
under the Phase 6 update policy. Students' project directories must remain
outside the replaceable container.

### Existing server-hosted workspaces during transition

Until local-first rollout is complete, server operators continue using the
existing deployment procedure: pull the selected workspace image and rebuild
managed workspace containers during a maintenance window. The rebuild removes
containers and leases, not the separately stored project/editor-home data. Do
not use this destructive container-recreation operation as the design for local
student updates; local updates must preserve local project storage and provide
rollback.

## Open Questions Before Implementation

- Which Windows/macOS versions and CPU architectures are in scope?
- What are the minimum RAM and free disk requirements for student devices?
- Is Docker Desktop the only supported runtime, and who helps students without
  installation privileges?
- Does removing a student from the roster disable their account immediately,
  or is an explicit admin disable required?
- Are submissions source-only, or must they include assets and generated
  reports?
- Does Mark Complete record the student's declaration, or require a verified
  build/test result?
- How long should previous workspace images remain available for rollback?
- What is the centrally hosted fallback for students whose personal devices
  cannot run Docker?
