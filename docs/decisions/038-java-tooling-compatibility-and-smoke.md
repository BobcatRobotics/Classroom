# 038 — Java tooling compatibility, extension reconciliation, and real-image smoke

Status: **Accepted and implemented** — 2026-08-31

## Context

Commit `35d640e` correctly added `--do-not-include-pack-dependencies` to enforce
the workspace image's explicit VSIX pins. Before that change, Open VSX pack and
dependency resolution silently replaced several requested extensions with
newer versions and an embedded Java 21 runtime. Enforcing the declared matrix
exposed that it was internally incompatible:

- the image supplied only Temurin 17;
- Java Debug 0.59 and Gradle extension JDT bundles require JavaSE 21, so Java
  Debug never registered commands such as `vscode.java.resolveMainMethod`;
- Java Test 0.45 was older than the JDT/ASM bundle set expected by current Red
  Hat Java.

The visible `No delegateCommandHandler for vscode.java.resolveMainMethod`
message was downstream of that failed bundle activation. A manifest/version
assertion could not detect it.

## Decision

### Keep separate tooling and project JDKs

The image contains two pinned, multi-architecture Temurin JDKs:

| Role | Version | Configuration |
|---|---|---|
| Project, Gradle CLI, robot simulation | 17.0.15+6 | `JAVA_HOME=/usr/lib/jvm/jdk-17` |
| JDT Language Server | 21.0.12.1+1 | `JDK_HOME=/usr/lib/jvm/jdk-21` |

Machine settings also declare JavaSE-17 as the default project runtime and set
`java.import.gradle.java.home` to the Java 17 installation. The bundled robot
project continues to declare `sourceCompatibility` and `targetCompatibility`
as Java 17. This keeps WPILib's build and supported headless simulation path on
the previously validated runtime while satisfying the current JDT bundle
requirement.

The initial implementation selected the tooling JDK through
`java.jdt.ls.java.home`. Runtime testing of a freshly imported robot exposed
that the WPILib VS Code extension 2026.1.1 reads that setting first, then passes
it to every editor Gradle task as both `JAVA_HOME` and
`-Dorg.gradle.java.home`. That forced the robot build onto Java 21 and broke the
project's Spotless 6.12/google-java-format step. Red Hat Java also supports
discovering its tooling runtime from
`JDK_HOME`, whereas WPILib falls through to `JAVA_HOME`. The corrected split
therefore leaves `java.jdt.ls.java.home` unset, supplies Java 21 through
`JDK_HOME`, and retains Java 17 in `JAVA_HOME`. Startup removes only the former
CodeRunner-provided `java.jdt.ls.java.home=/usr/lib/jvm/jdk-21` value from
existing Machine and project settings.

### Pin a compatible Java extension matrix

Every artifact remains an explicit versioned VSIX or pinned-source build, and
gallery dependency resolution remains disabled:

| Extension | Version |
|---|---|
| `redhat.java` | 1.55.0 |
| `wpilibsuite.vscode-wpilib` | 2026.1.1 |
| `vscjava.vscode-java-debug` | 0.59.0 |
| `vscjava.vscode-java-test` | 0.46.0 |
| `vscjava.vscode-maven` | 0.45.3 |
| `vscjava.vscode-gradle` | 3.18.0 |
| `vscjava.vscode-java-dependency` | 0.27.6 |
| `vscjava.vscode-java-pack` | 0.31.1 |
| `richardwillis.vscode-spotless-gradle` | 1.2.1 |

Red Hat Java 1.55 and Java Test 0.46 contain identical ASM 9.10.1 OSGi bundles.
On a genuinely fresh workspace JDT logs an "already installed" warning for
`org.objectweb.asm`, `org.objectweb.asm.tree`, and
`org.objectweb.asm.commons`. The resolver keeps the identical bundles already
installed from Red Hat Java; Java Test commands and the complete Java Debug
command list then register normally. The real-image smoke proves F5 execution
and `vscode.java.resolveMainMethod`. Only those exact same-version warnings are
accepted; a different bundle conflict, a missing command, or any
`No delegateCommandHandler` message is a failure.

### Reconcile managed extensions on every container start

First-boot-only copying left existing `/config/extensions` homes permanently
on the old pins. `init-frc-setup` now calls a small reconciliation script that
uses the baked `extensions.json` as the managed-ID allowlist. When a managed
version or directory differs, it:

1. removes only directories belonging to those managed IDs;
2. copies the current baked directories;
3. merges their manifest records with all non-managed records from the
   existing workspace;
4. removes only matching managed entries from `.obsolete`.

An already matching workspace is untouched. Student-installed extensions and
their manifest entries are preserved. Unit coverage exercises an empty home,
an old pinned home, and a home containing an unrelated student extension.

### Add a targeted real-container smoke

`bun run e2e:workspace-java` starts fresh real workspace containers and drives
the real VSCodium workbench with Playwright. It performs the following:

- opens `hello-world/src/Main.java`, verifies the JDT LS process uses Java 21,
  waits for `Java: Ready`, presses F5 on the `Run Main` launch configuration,
  and verifies compilation plus visible
  `Hello, World!` terminal output;
- checks JDT's registered command enumeration for
  `vscode.java.resolveMainMethod` and rejects every
  `No delegateCommandHandler` error;
- opens `robot-starter`, waits for JDT/Gradle import, invokes **WPILib: Build
  Robot Code**, verifies WPILib's generated command and Gradle daemon both use
  Java 17, rejects the observed Spotless/JDK failure, checks the resulting
  classfile is Java 17, and starts then stops CodeRunner's supported
  `start-sim.sh` → `run-sim.sh` headless simulation path.

The test is deliberately outside `bun run verify` because it requires Docker
and a prebuilt multi-gigabyte image. It is required acceptance for workspace
JDK, editor-base, Java/WPILib extension, or init changes.

## Consequences

- The image grows by roughly one compressed JDK installation; reliability and
  preserving the validated Java 17 robot runtime outweigh that cost.
- Recreating existing workspace containers is sufficient to apply extension
  upgrades. Deleting student home or project directories is unnecessary.
- Extension manifests remain useful build-time checks, but Java tooling changes
  are not accepted without the real runtime smoke.
