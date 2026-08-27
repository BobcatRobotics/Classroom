---
sidebar_position: 3
title: Workspace Image
---

# Workspace Image

The workspace image (`ghcr.io/mathewdunne/coderunner-workspace`) is the
per-student container that runs
VSCodium reh-web (`codium-server`), Java 17, and the WPILib simulation stack in a single
Docker image. The [workspace container overview](../about/workspace-container.md)
explains the runtime contract from the application's perspective; the
[container README](https://github.com/mathewdunne/CodeRunner/blob/main/containers/code/README.md)
is the authoritative reference for bind mounts, published ports, labels,
and environment variables.

This page covers how to build, update, and refresh the image during
development.

## Image size

The built image is approximately 2.3 GiB uncompressed. That includes JDK 17
(~300 MB), the VSCodium reh-web runtime, nine VS Code extensions, and one
primed Gradle/WPILib dependency-cache layer (~1.2 GiB) baked in so first builds
inside the container take seconds rather than minutes.

## Building the image locally

```bash
bun run docker:build:workspace
```

This runs `scripts/image.ts`, which calls:

```
docker build -f containers/code/Dockerfile -t ghcr.io/mathewdunne/coderunner-workspace:latest .
```

The build context is the repo root. The image is tagged with its canonical
name — `${CODERUNNER_IMAGE_NS:-ghcr.io/mathewdunne}/coderunner-workspace:${CODERUNNER_TAG:-latest}` —
the same name docker compose and the control plane's `CODE_IMAGE` default
resolve to, so a local build is picked up directly by `docker compose up` or
`bun run dev:control` with no re-tagging. Forks set `CODERUNNER_IMAGE_NS` (in
`.env`) to their own registry/owner; `CODE_IMAGE` overrides the full image
name outright.

## Pulling from GHCR

If you only need to run the app (not change the image), pull the published
image instead of building:

```bash
bun run docker:pull:workspace
```

This pulls the same canonical name. The same pull runs as part of
`bun run build` (the production build step). Note a pull overwrites the
`latest` tag, so it replaces any locally built image of the same name.

Publishing images to GHCR is done exclusively by CI (the release workflow in
`.github/workflows/deploy.yml`), not from a developer machine.

## When to rebuild

Rebuild the image when you change any of the following:

- `containers/code/Dockerfile`: any layer change (base image bump, JDK version, extension versions, sim scripts, s6-overlay service definitions)
- `containers/code/` scripts: `start-sim.sh`, `run-sim.sh`, `stop-sim.sh`, `sim-headless.init.gradle`, or any file under `containers/code/root/`
- `catalog/`: the bundled lesson catalog is baked into the image at
  `COPY catalog/ /opt/frc-catalog/` and used to prime the Gradle/WPILib cache
  during the build. If you change module content (especially the
  `robot-starter` module, which is the cache-priming source), rebuild the
  image so the baked catalog and Gradle cache stay in sync.

You do not need to rebuild for changes to `apps/control/`, `apps/web/`, or
`packages/contracts/`; those run on the host, not inside the container.

When bumping `linuxserver/vscodium-web`, also update the pinned
`VSCODE_WEBVIEW_COMMIT` in the Dockerfile to the upstream VS Code revision used
by that VSCodium release. The build deliberately asserts the old embedded
revision count and will fail until the patch is reviewed. Smoke-test a
script-bearing extension webview (the WPILib Vendor Dependencies activity is
the current acceptance case), not only the editor shell.

## Editor acceptance smoke

After an editor/base-image or critical-extension change, test the real built
image in a fresh workspace rather than relying only on the mocked E2E tier:

1. Open the bundled `robot-starter` project and wait for `Java: Ready`. Confirm
   no Gradle error item appears beside it and the Gradle output contains no
   `Unknown command-line option '-X'` message.
2. In `Robot.java`, type an unimported `Pose2d`, accept the WPILib completion,
   and confirm it adds `edu.wpi.first.math.geometry.Pose2d`. Use F12 or
   Ctrl-click on the type and confirm the WPILib library source opens through a
   `jdt://` document.
3. Open the **WPILib Vendor Dependencies** activity. Confirm the installed
   vendordeps render (not only the static **Update All** button), then use its
   refresh action once.
4. Run the project through CodeRunner and confirm the normal build/simulation
   path still starts.

These are intentionally built-image acceptance checks. The mocked Playwright
tier does not load the real editor or extension webviews.

## Refreshing running student containers

After rebuilding and pushing a new image, containers that are already running
on the host continue to use the old image until they are re-created. Use:

```bash
bun run docker:rebuild-workspaces
```

This runs `scripts/rebuild-workspaces.ts`, which:

1. Lists all managed V2 workspace containers
   (filtered by `frc-sim.managed=true` and `frc-sim.version=v2` labels).
2. Force-removes each one with `docker rm -f`.
3. Clears all `container_leases` rows in the SQLite database
   (sets `code_state` to `'missing'` and nulls the port/container columns).

Student project files and editor state are preserved; they live in
bind-mounted directories under `data/users/` and are never touched by this
script. The control plane re-creates containers on next request using the
new image.

Pass `--dry-run` to see what would be removed without making changes:

```bash
bun run docker:rebuild-workspaces -- --dry-run
```
