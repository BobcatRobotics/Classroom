# 037 — Workspace cache aliases, extension pins, and trust

Status: **Accepted and implemented** — 2026-08-26

Acceptance testing after
[`036-vscodium-web-migration.md`](./036-vscodium-web-migration.md) found three
pre-existing workspace-image problems.

## 1. Share the primed Gradle distribution with WPILib projects

The image primes `GRADLE_USER_HOME` by building the bundled `robot-starter`
module. That wrapper uses `distributionPath=wrapper/dists`, while
WPILib-generated projects use `permwrapper/dists`. Imported team projects
therefore downloaded Gradle again on first run and failed offline.

Gradle derives the distribution directory name from `distributionUrl`, not
`distributionPath`, so the two layouts can share one extraction. The image now
creates this relative alias after priming:

```text
permwrapper -> wrapper
```

The init script also adds the alias to existing homes that have `wrapper` but
not `permwrapper`. It preserves an existing real `permwrapper` cache. The image
build fails if a future catalog template creates `permwrapper` itself instead
of silently nesting a bad link inside it.

This avoids both a first-run download and about 146 MiB of duplicate extraction
per workspace. Projects using another Gradle URL still miss cleanly and
download their own distribution.

## 2. Prevent gallery resolution from replacing pinned VSIXs

The Dockerfile downloads the Java extensions at explicit versions, but
`codium-server --install-extension` normally resolves `extensionPack` and
`extensionDependencies` entries through Open VSX. That replaced four requested
versions with gallery-latest builds, made the image build time-dependent, and
left superseded extension trees in the baked cache.

All required extensions are already supplied as local VSIXs. The install step
now passes `--do-not-include-pack-dependencies`, then verifies that
`extensions.json` contains exactly the nine expected IDs and versions with
`source=vsix` and `pinned=true`. A VSCodium change that removes or alters the
flag will therefore fail the image build instead of silently drifting.

The Java Extension Pack remains installed. It contributes Java commands,
walkthroughs, formatter/classpath UI, and the Gradle extension's Install New JDK
integration, so removing it would be a user-visible change with no remaining
technical benefit.

Extension seeding remains first-boot-only. Existing `/config/extensions`
directories are preserved, including user-installed extensions, and are not
reset to the new baked manifest during an image upgrade.

## 3. Disable workspace trust in the hosted workbench

Fresh workspaces opened in Restricted Mode, leaving `redhat.java` in Lightweight
Mode until the student clicked Trust. Server-side settings cannot disable this:
`security.workspace.trust.enabled` is application-scoped and the browser's
application settings are not read from `/config/data/{User,Machine}`.

The server already exposes the required control. The workspace service now
starts `codium-server` with:

```text
--disable-workspace-trust
```

The server passes `enableWorkspaceTrust: false` to the web workbench, so no
VSCodium patch or pre-seeded browser state is required.

This removes VS Code's protection against repository-controlled automatic
behavior, including folder-open tasks. CodeRunner already lets a student import
a public repository and execute it in a dedicated workspace container, but the
earlier execution point matters: a malicious imported repository could access
files in that student's `/config` before they click Run. The accepted tradeoff
is a classroom flow with immediate Java support; container isolation remains the
security boundary between students and the host.

## Follow-up: browser-owned settings

The trust investigation also confirmed that browser-local User settings are not
backed by `/config/data/User/settings.json` in a web workbench. The server does
load `/config/data/Machine/settings.json` as Remote/Machine configuration for
non-application scopes, including window and resource settings. The init script
now seeds its Java/Gradle limits and theme there. `workbench.startupEditor`
still loses to browser startup and extension walkthrough state even from
Machine settings, so the ineffective seed was removed. A reliable README
auto-open needs either a top-level workbench default from a server patch or an
explicit editor URL payload. Application-scoped settings such as workspace
trust require a server or browser-side control.
