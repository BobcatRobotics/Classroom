# 035 — Editor migration: openvscode-server → VSCodium reh-web

Status: **Accepted (not yet implemented)** — 2026-08-24

Implementation is planned in
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

`codium-server` accepts the same `--user-data-dir` and `--extensions-dir` flags,
and `--server-data-dir <dir>` produces `<dir>/data/User/` and
`<dir>/data/Machine/` — structurally identical to the current layout. So
`/config/data/{User,Machine}/settings.json` and `/config/extensions` are
unchanged, `init-frc-setup` needs no path edits, and 026's Machine-scoped theme
seeding continues to work through the same mechanism.

Build-time VSIX sideloading is likewise unchanged: `--install-extension
<path.vsix>` is stock upstream behaviour. Both critical extensions installed
cleanly onto 1.126.04524 at their currently pinned versions —
`wpilibsuite.vscode-wpilib@2026.1.1` and `redhat.java@1.38.0`.

## What was verified, and what was not

Verified hands-on against the real tarball on 2026-08-24, including a headless
Chromium session against the workbench: base-path serving with prefixed assets,
WebSocket upgrade under the prefix, `?folder=`, VSIX sideload of both critical
extensions, the `data/{User,Machine}` layout, and **extension host activation** —
`redhat.java` loaded and surfaced its `Java: Lightweight Mode` status item, with
zero failed requests and zero console errors. `--accept-server-license-terms` is
not required; that flag belongs to Microsoft's proprietary server build.

Not verified, and deliberately deferred to implementation: that `redhat.java`
progresses past Lightweight to **Standard Mode** with a full Gradle import. The
spike machine had no JDK, so the language server could not start. The built
image has JDK 17 and a primed Gradle cache, which is where this must be
confirmed. This is the one finding that could still invalidate the migration.

## Open question: workspace trust

The spike workbench opened in **Restricted Mode**, which holds `redhat.java` in
Lightweight Mode and blocks a full project import. The repository configures
workspace trust nowhere — no setting in `catalog/`, `containers/`, or
`apps/control/src`.

This is not VSCodium-specific; it would behave identically on openvscode-server
or code-server, and may already be the behaviour today. It is recorded because
it is precisely what a "the migration broke Java" report would look like, and
because diagnosing it from scratch mid-migration would waste a day.

If verification shows trust is the blocker, the fix belongs in
`init-frc-setup`'s existing settings merge as
`"security.workspace.trust.enabled": false`, seeded with `//=` so a student's
own choice survives. It must go in **User** settings: the setting is
`application`-scoped in VS Code, so seeding it into Machine or Workspace scope
would silently do nothing — a failure mode that looks like the fix not working
rather than being misplaced. It must also stay out of project scope, since
`/workspace/project/.vscode/settings.json` is student-owned and gets committed
to team repositories.

The fix is gated behind verification rather than applied pre-emptively, so we do
not ship a security-relevant default to work around a problem we have not
confirmed we have.

## Consequences

- **Decision 011 is no longer the live evidence record.** It documented the
  openvscode-server spike — `?folder=` boot, `additionalTextEdits` on tab,
  `jdt://` navigation — for an editor we no longer ship. It stays as history;
  this decision plus the plan's verification steps replace it.
- **AGENTS.md's re-verification rule now fires.** It says not to re-verify
  upstream extension-owned behaviour "unless editor or extension versions
  changed." The editor version changes from 1.109.5 to 1.126.04524, so the Java
  editing behaviours 011 recorded are exactly what must be re-checked once —
  auto-import on completion and Ctrl-click into library source, not just "the
  extension loads."
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
- **The webview CDN dependency is unchanged.** Both openvscode-server and
  VSCodium ship a byte-identical `webviewContentExternalBaseUrlTemplate`
  pointing at `*.vscode-cdn.net`, inherited from the same upstream. Whatever
  that implies for offline use, it is not a regression introduced here.
- **Unrelated issue left standing.** `containers/code/Dockerfile` still fetches
  the `vscode-spotless-gradle` VSIX from a Microsoft Marketplace host, which
  `THIRD_PARTY_NOTICES.md` already flags as a terms-of-use problem. It shares
  the extension-sourcing code path and was deliberately excluded from this
  migration so a regression in either would be unambiguous.
