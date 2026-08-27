# 036 — Editor migration: openvscode-server → VSCodium reh-web

Status: **Accepted and implemented** — 2026-08-24

Implementation followed
[`../superpowers/plans/2026-08-24-vscodium-web-migration.md`](../superpowers/plans/2026-08-24-vscodium-web-migration.md).
Supersedes the editor choice in
[`017-linuxserver-base-migration.md`](./017-linuxserver-base-migration.md) and
retires [`011-v2-editor-spike.md`](./011-v2-editor-spike.md) as the live
evidence record. Preserves the seeding mechanism from
[`026-editor-default-theme.md`](./026-editor-default-theme.md).

## Context

The workspace image's editor is the browser-facing surface every student
touches, and it stopped receiving updates.

`gitpod-io/openvscode-server` last released `1.109.5` on 2026-02-20. Upstream
VS Code stable is `1.134.0`. The repository is not archived and carries no
deprecation banner, so it looks alive from the outside; the release feed says
otherwise.

LinuxServer.io deprecated their `docker-openvscode-server` image on 2026-07-16
— the image we adopted in 017 — stating that the upstream project is no longer
updating. Their recommended replacements are `code-server` and their own
`vscodium-web` image. Their deprecation is downstream confirmation of the same
fact, not an independent one: only pinned version tags remain pullable, so the
current pin keeps working but nothing new arrives.

Three High-severity Visual Studio Code advisories were published on 2026-08-11
— CVE-2026-70336, CVE-2026-69320, CVE-2026-59113, all CVSS 8.8 with network
attack vectors. GitHub's advisory database carries no affected-version ranges
for any of them (VS Code is not a tracked package ecosystem), so it is **not**
established that 1.109.5 is specifically vulnerable to these three, and this
decision does not claim it is. The structural point is what matters: a build
frozen 25 minor versions back receives no security fix, ever, and the category
those advisories sit in is exactly ours.

## Decision

### 1. VSCodium `reh-web`, not `code-server`

`code-server` is the better-maintained project on paper — weekly releases
tracking VS Code within about one minor version, funded by Coder Inc., against
VSCodium's volunteer cadence of one release every 3.5–7 weeks. It was the
initial recommendation. It was rejected on a single technical fact.

**`codium-server` supports `--server-base-path`. `code-server` does not.**

The control plane mounts each student's editor at `/u/<slug>/vscode/` and
forwards the full request path upstream unchanged, because the editor is
launched with `--server-base-path /u/<slug>/vscode/` and therefore owns its own
prefix. Verified against a real `vscodium-reh-web-linux-x64-1.126.04524`
tarball: the workbench served under that prefix emits **absolute, prefixed**
asset URLs (`/u/test-slug/vscode/stable-<sha>/static/out/...`), returns `101
Switching Protocols` for a WebSocket upgrade under the prefix, and honours
`?folder=`. That is the contract `apps/control/src/app/proxy.ts` already
implements, unchanged.

`code-server` has no such flag — `--abs-proxy-base-path` governs only its
built-in `/absproxy/<port>` application proxy. It instead emits **relative**
URLs and infers its base client-side. Its own `patches/base-path.diff` is
explicit:

> All paths must be relative in order to work behind a reverse proxy since we
> do not know the base path. Anything that needs to be absolute (for example
> cookies) must get the base path from the frontend.

Adopting it would have meant inverting the proxy contract from *server owns the
prefix* to *proxy strips the prefix, client re-infers it*: changes in
`workspace-routes.ts`, `converters.ts`, `local-docker-runtime-provider.ts`, and
the run script, plus two test assertions. That is roughly twenty lines, which is
not the objection. The objection is that correctness would then depend
permanently on every entry URL carrying a trailing slash. Confirmed empirically:
behind a prefix-stripping proxy, `/u/<slug>/vscode/` serves correctly and its
assets resolve, while `/u/<slug>/vscode` (no slash) returns 200 rather than
redirecting, at which point relative resolution walks up one segment too far and
every asset 404s. Today's entry URL does carry the slash
(`WorkspacePage.tsx`), so it would work — until something constructs the URL
without one.

The currency argument that favoured `code-server` was weighed against actual
requirements and found not to apply. The base image is bumped 2–3 times a year,
not tracked continuously; VSCodium's cadence means any bump lands on something
0–7 weeks old. That is a different situation from a six-month freeze with no
prospect of a release.

### 2. Stay on the LinuxServer base image

`linuxserver/vscodium-web:1.126.04524-ls35` is built `FROM
ghcr.io/linuxserver/baseimage-ubuntu:noble` — the same base OS we run today —
and preserves everything 017 adopted the LinuxServer image for: s6-overlay
supervision, the `abc` user, runtime `PUID`/`PGID`, `lsiown`, and `/config` as
`HOME`. The Dockerfile diff is a base image, a service-directory rename, and a
binary path.

Considered and rejected for now: installing the `vscodium-reh-web-linux-x64`
tarball onto `baseimage-ubuntu:noble` directly. It removes the dependency on a
second upstream and allows bumping VSCodium the day a release drops rather than
waiting for an `-lsNN` tag (in practice same-day). The cost is owning the s6
service definition — roughly ten lines of Dockerfile plus four small s6 files.
**This is the documented fallback** if LinuxServer deprecates `vscodium-web`;
recording it here means it does not have to be re-derived under time pressure.

### 3. The editor keeps container port 3000

The LinuxServer image exposes 8000. Because we override the service run script
anyway, passing `--port 3000` costs nothing and means `VSCODE_CONTAINER_PORT`,
the published port ranges, the lease table, and every proxy endpoint stay
untouched. Aligning to 8000 would have rippled through the control plane for no
benefit.

### 4. Settings and extension paths do not move

`codium-server` parses `--user-data-dir` but — unlike openvscode-server, which
carried a Gitpod patch honouring it — unpatched upstream unconditionally
overwrites it with `<server-data-dir>/data`
(`src/vs/server/node/server.main.ts`; VSCodium patches neither that file nor
the default, and `product.json`'s `serverDataFolderName` is
`.vscodium-server`). The run script therefore passes `--server-data-dir
"${HOME}"`, which yields `/config/data/User/` and `/config/data/Machine/` —
structurally identical to the previous layout. So
`/config/data/{User,Machine}/settings.json` and `/config/extensions` are
unchanged, `init-frc-setup` needs no path edits, and 026's Machine-scoped theme
seeding continues to work through the same mechanism. (This section originally
claimed `--user-data-dir` was honoured; see the post-review correction below.)

Build-time VSIX sideloading is likewise unchanged: `--install-extension
<path.vsix>` is stock upstream behaviour. Both critical extensions installed
cleanly onto 1.126.04524 at their currently pinned versions —
`wpilibsuite.vscode-wpilib@2026.1.1` and `redhat.java@1.38.0`.

### 5. Workspace trust: diagnosed, not fixed

The spike workbench opened in **Restricted Mode**, which holds `redhat.java` in
Lightweight Mode and blocks a full project import. The repository configures
workspace trust nowhere — no setting in `catalog/`, `containers/`, or
`apps/control/src`. The spike posed this as an open question gated on
implementation-time verification; verification has now run it down, and the
answer is a third outcome — neither of the two branches originally planned for.

**Confirmed as the cause.** A headless Chromium session polling the built
image's workbench every 20 seconds for 3 minutes showed `Restricted Mode` and
`Java: Lightweight Mode` on every single poll, with only a syntax-server
workspace (`ss_ws`) present container-side and no `jdt_ws` — confirmed twice,
independently. Manually clicking "Trust" in the UI fixes it immediately: a real
`jdt_ws` import follows and the status item reaches `Java: Ready` in about 40
seconds.

**The proposed fix does not work.** Seeding
`"security.workspace.trust.enabled": false` into
`/config/data/User/settings.json` — the fix originally specified above —
changed nothing. Tested twice, once on a completely fresh container with no
cached trust state anywhere under `/config`; Restricted Mode persisted
identically both times. The likely explanation, found by inspecting the served
workbench bundle: `security.workspace.trust.enabled` is read through VS Code's
`applicationConfiguration` path, kept separate from the
`localUserConfiguration`/`remoteUserConfiguration` VS Code merges into effective
settings — the same scoping rule that greys the setting out in Remote-SSH
windows. In a purely browser-hosted deployment there appears to be no route
from a server-side `settings.json` write into that application-scoped read,
though the exact mechanism was not fully pinned down without instrumenting the
server.

> **Post-review correction (2026-08-26):** this experiment wrote to
> `/config/data/User/settings.json` — a file the server never read, because
> the `--user-data-dir` flag the image relied on is ignored by unpatched
> codium-server (see the correction section below). The negative result and
> the `applicationConfiguration` theory above are both void. The experiment
> must be re-run against an image carrying the `--server-data-dir` fix before
> concluding anything about workspace trust.

> **Follow-up:** the rebuilt image confirmed that User settings, Machine
> settings, and `product.json` defaults cannot override this
> application-scoped setting. Decision
> [`037`](./037-gradle-wrapper-alias-and-extension-pins.md) closes the issue with
> codium-server's `--disable-workspace-trust` flag.

**It is not a regression.** The currently published production image
(`ghcr.io/mathewdunne/coderunner-workspace:latest`, openvscode-server-based,
revision `ffa7b47`, built 2026-08-13) was run through the identical
observation and behaved identically: Restricted Mode, Lightweight Mode, only
`ss_ws`, no `jdt_ws`. Neither editor's `product.json` disables workspace trust,
and the repository has never configured it either way. This predates the
migration; it is simply the first time anyone looked closely enough to notice.

**No change was made in this migration.** `init-frc-setup` was not edited for trust — the
proposed `jq` addition above was never applied. Since the tested fix doesn't
work and the behaviour is pre-existing rather than migration-caused, forcing a
fix through under this migration's review would have made an unrelated
regression risk hard to disentangle from the editor swap. A working fix, if
wanted, needs one of: a mechanism that actually reaches the application-scoped
setting from the server side (candidates worth investigating: VSCodium's
`product.json` `configurationDefaults`, which overrides a setting's *default*
rather than writing a user override and so may not be subject to the same
scope rule; a `codium-server` CLI flag or environment variable, if one exists;
or an enterprise policy file); seeding trust *state* directly rather than the
setting (a pre-populated trust-decision cache keyed to `/workspace/project`);
or, more simply, documenting the one-time "Trust" click as an expected
first-run step for students and instructors. Any candidate needs the same
verification used here: a clean container, a multi-minute poll, and a
container-side `jdt_ws` check.

## What was verified, and what was not

Verified hands-on against the real tarball on 2026-08-24, including a headless
Chromium session against the workbench: base-path serving with prefixed assets,
WebSocket upgrade under the prefix, `?folder=`, VSIX sideload of both critical
extensions, the `data/{User,Machine}` layout, and **extension host activation** —
`redhat.java` loaded and surfaced its `Java: Lightweight Mode` status item, with
zero failed requests and zero console errors. `--accept-server-license-terms` is
not required; that flag belongs to Microsoft's proprietary server build.

Re-verified against the actual built image once Tasks 1–2 landed (container
`cr-smoke`, since torn down), with the same results plus the piece the spike
couldn't reach: the workbench serves under `/u/smoke/vscode/` with absolute
prefixed asset URLs
(`/u/smoke/vscode/stable-4c0b0c6cc561d2d3636d1ec250935431876ce4dc/static/out/vs/code/browser/workbench/workbench.js`),
WebSocket upgrade under the base path returns `101 Switching Protocols`,
settings were present at `/config/data/{User,Machine}` and `/config/data/data/`
did not exist — observations this doc originally read as "`--user-data-dir` is
honoured". That inference was wrong: `init-frc-setup` writes those files
itself, so their presence proves nothing about what the server *reads*, and
the actual miss path was `/config/.vscodium-server/data/`, which was never
checked. See the post-review correction below. Machine settings carry
`"workbench.colorTheme": "Default Dark Modern"`; User settings carry the
`java.jdt.ls.vmargs` and Gradle keys. Ownership after Task 2's scoped `lsiown`
is `abc:abc` on `/config/.gradle`, `/config/extensions`, both settings files,
and `/config/sim.log`. The JDK is `openjdk version "17.0.15"` (Temurin
17.0.15+6); all three sim scripts are present and executable. All nine bundled
extensions install cleanly under `codium-server --install-extension`. The base
image facts behind decision 2 were confirmed by direct inspection too:
`/etc/s6-overlay/s6-rc.d/svc-vscodium-web/` ships `type` (longrun) and
`notification-fd` from the base image, so our image overrides only `run`; s6
brings services up in order `init-vscodium-web → init-config-end →
init-frc-setup → svc-vscodium-web`; and the base's own init runs `find /config
-path /config/workspace -prune -o -exec lsiown abc:abc {} +` every boot, which
is what justifies decision 033's concern and Task 2's scoping.

Page-load health improved over the outgoing image. The new image produced 1
console error and 1 failed request on the same workbench page — both the same
benign cause, a 404 from
`https://open-vsx.org/vscode/gallery/richardwillis/vscode-spotless-gradle/latest`
(an update check for an extension actually sourced from the Microsoft
Marketplace, so Open VSX has no record of it). The outgoing openvscode-server
image, checked side by side on the identical page, produced 3 console errors
and 5 failed requests, including a missing
`static/node_modules/vsda/rust/web/vsda_bg.wasm` and `vsda.js`, and an aborted
external `vscode-cdn.net` webview fetch.

**The initial migration did not verify the three Java editing behaviours that
decision 011 recorded as evidence.** `redhat.java` never left Lightweight Mode
on its own during that verification — see decision 5, above — so WPILib type
completion, completion-driven auto-import, and navigation into library source
were not individually exercised at that point. The post-acceptance work closed
both implementation blockers: decision 037 disables workspace trust at the
server and removes the editor Gradle arguments that prevented Buildship
synchronization. A clean rebuilt image reaches `Java: Ready` with
`Gradle: Configure project : succeeded` and no Gradle error status. The three
editor interactions now live in the repeatable acceptance checklist in
`docs/development/workspace-image.md`; they are a release smoke gate for the
rebuilt image rather than an open migration implementation task.

The regression gate confirms nothing outside the editor moved: `bun run
typecheck` exits 0; `bun run check` exits 0 across 264 files; `bun run test` is
376 pass / 0 fail; `bun run test:web` is 85 pass; `bun run e2e` is 56 pass;
`bun run e2e:security` is 8 pass. No control-plane source file changed as part
of this migration.

## Post-review correction (2026-08-26): `--user-data-dir` is ignored

An adversarial review of this branch traced the shipped
`vscodium-reh-web-linux-x64-1.126.04524` bundle and upstream source and found
the original run script's `--user-data-dir "${HOME}/data"` was silently
discarded: stock VS Code server computes `USER_DATA_PATH =
join(REMOTE_DATA_FOLDER, 'data')` and unconditionally overwrites the parsed
flag (`src/vs/server/node/server.main.ts`, identical at 1.109/1.120/1.126),
and VSCodium applies no patch there. openvscode-server honoured the flag only
because Gitpod patched exactly that line
(`USER_DATA_PATH = args['user-data-dir'] || ...`). With no `--server-data-dir`
passed, the real data root was `/config/.vscodium-server/data/` — so every
setting `init-frc-setup` seeds (bounded `java.jdt.ls.vmargs`,
`java.gradle.buildServer.enabled: off`, `gradle.autoDetect: off`, and the
Machine dark theme) would never have been read, and the
control plane's `imports.ts` purge of `/config/data/User/workspaceStorage` on
lesson switch would have been a silent no-op. Gradle-side limits in
`gradle.properties` were unaffected (read via `GRADLE_USER_HOME`, not the
editor).

**Fix applied:** the run script now passes `--server-data-dir "${HOME}"`
instead of `--user-data-dir`, which derives `/config/data/{User,Machine}` and
a default extensions dir of `/config/extensions` — bit-identical to the layout
everything else already assumes. `containers.test.ts` pins the flag (and the
absence of `--user-data-dir`). Sections 4 and 5 and the verification account
above carry inline corrections. The follow-up re-run and final workspace-trust
fix are recorded in decision
[`037`](./037-gradle-wrapper-alias-and-extension-pins.md).

## Post-acceptance correction (2026-08-26): webview CDN revision

The WPILib Vendor Dependencies activity opened after the migration, but showed
only its static **Update All** button. The extension host had loaded, parsed the
project's installed vendordeps, registered the webview provider, and enabled
scripts. The failure was lower in the webview resource transport: every local
script and stylesheet request rejected with `A ReadableStream could not be
cloned because it was not transferred`.

`linuxserver/vscodium-web:1.126.04524-ls35` carries the VSCodium 1.126
workbench, whose webview protocol uses service-worker version 5 and
transferable `ReadableStream` responses. Its product configuration nevertheless
pointed `webviewContentExternalBaseUrlTemplate` at VS Code revision
`ef65ac1ba57f57f2a3961bfe94aa20481caca4c6`, whose CDN bundle implements the
older version-4, `ArrayBuffer` protocol. The workbench and externally hosted
bootstrap therefore disagreed on the message shape, so no `vscode-resource`
asset could load. The same defect affects any extension webview with local
assets, not just WPILib.

The image now replaces that stale revision with VS Code 1.126.0 revision
`7e7950df89d055b5a378379db9ee14290772148a`. The CDN's `index.html` at that
revision is byte-identical to the bootstrap bundled in VSCodium 1.126. VSCodium
inlines product configuration into its compiled JavaScript, so the image
replaces all eight occurrences in `product.json` and `out/`. The Dockerfile
requires exactly eight occurrences of both the old and replacement revision,
so a future LinuxServer/VSCodium bump fails the image build instead of silently
retaining an obsolete patch. Each base bump must identify the new upstream VS
Code revision and re-run a script-bearing webview smoke test.

## Consequences

- **Decision 011 is no longer the live acceptance record.** It documented the
  openvscode-server spike — `?folder=` boot, `additionalTextEdits` on tab,
  `jdt://` navigation — for an editor we no longer ship. It stays as history;
  the reusable workspace-image acceptance checklist replaces it.
- **AGENTS.md's re-verification rule fired and is now an image acceptance
  gate.** It
  says not to re-verify upstream extension-owned behaviour "unless editor or
  extension versions changed." The editor version changes from 1.109.5 to
  1.126.04524, so the Java editing behaviours 011 recorded are exactly what
  must be checked on the rebuilt image — auto-import on completion and
  navigation into library source, not just "the extension loads." The original
  verification was blocked by workspace trust; decision 037 and the Gradle
  argument correction remove those blockers, and the maintained checklist now
  carries the one-time migration check forward as the editor-version smoke
  test for every future base bump.
- **Each base bump crosses a wider delta than before.** VSCodium releases jump
  4–5 minor versions at a time, against openvscode-server's old roughly monthly
  single-version cadence. At 2–3 bumps a year that is acceptable, but every bump
  needs a smoke test rather than a version-tag edit.
- **Adoption risk is real and accepted.** `linuxserver/vscodium-web` had ~28.5k
  Docker Hub pulls at time of writing, against ~780k for the openvscode-server
  image LinuxServer just deprecated, and the repository is roughly eight months
  old (created 2025-12-18). We are re-entering the same dependency shape that
  just failed, on thinner ice. The mitigation is decision 2's documented
  fallback, not avoidance.
- **VSCodium's current gap is at the top of its normal range.** Latest release
  is `1.126.04524` (2026-07-07), roughly seven weeks old against a 3.5–7 week
  historical rhythm, and commits since are dependabot bumps in an unrelated
  subdirectory. Not a red flag on its own; worth a glance before each bump, and
  a trigger to revisit decision 1 if it stretches much further.
- **The external webview origin remains, with its revision corrected.** Both
  editors use `*.vscode-cdn.net` to isolate extension webviews from the
  workbench origin. The selected VSCodium image shipped an incorrect upstream
  revision in `webviewContentExternalBaseUrlTemplate`; the post-acceptance
  correction above pins it to the VS Code revision that VSCodium actually
  built. Webviews still require that CDN and therefore are not offline-only.
- **The Spotless sourcing follow-up is closed.** The formatter remains bundled,
  but its VSIX is now built from the publisher's pinned MIT-licensed source in
  a throwaway Docker stage. The image no longer downloads or redistributes the
  Visual Studio Marketplace artifact.
- **The extension-version drift follow-up is closed.** Four bundled extensions
  previously installed at versions above their
  `ARG *_VERSION` pins: `redhat.java` (pinned `1.38.0`, installs `1.55.0`),
  `vscjava.vscode-gradle` (pinned `3.17.3`, installs `3.18.0`),
  `vscjava.vscode-java-dependency` (pinned `0.27.2`, installs `0.27.6`), and
  `vscjava.vscode-java-test` (pinned `0.45.0`, installs `0.46.0`). Isolated by
  direct test: installing the `vscjava.vscode-java-pack` VSIX makes the editor
  fetch all six pack members from the Open VSX gallery at latest, overwriting
  the pinned installs; a pinned VSIX installed alone honours its version
  exactly. The old openvscode-server image does the same thing, so this
  predates the migration and is not caused by it. Decision 037 instead keeps
  the useful Java Extension Pack and passes
  `--do-not-include-pack-dependencies`, with an exact manifest assertion that
  prevents gallery resolution from replacing any pin.
