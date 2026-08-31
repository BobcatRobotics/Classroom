# VSCodium-web Editor Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the abandoned `openvscode-server` editor in the workspace container with VSCodium's `reh-web` build, via the actively maintained `linuxserver/vscodium-web` base image, with zero changes to the control plane.

**Architecture:** The workspace image swaps its base from `linuxserver/openvscode-server:1.109.5` to `linuxserver/vscodium-web:1.126.04524-ls35`. Both are LinuxServer images built on `baseimage-ubuntu:noble`, so the s6-overlay model, the `abc` user, PUID/PGID, `lsiown`, and `/config` as `HOME` all carry over unchanged. VSCodium's `codium-server` supports the same `--server-base-path`, `--without-connection-token`, `--user-data-dir`, and `--extensions-dir` flags as `openvscode-server`, and emits absolute base-path-prefixed asset URLs — so the control plane's pass-through proxy, the `/config/data/{User,Machine}` settings layout, and every test stay exactly as they are. The editor keeps listening on port 3000 so no port constant moves.

**Tech Stack:** Docker, s6-overlay, LinuxServer.io base images, VSCodium reh-web (`codium-server`), Bun + TypeScript control plane, Bun test, Vitest, Playwright.

**Spec:** No separate spec document — this plan is self-contained. The verified findings that justify it are in **Background** below; Task 7 records them permanently as decision log 036. Prior context: [`docs/decisions/017-linuxserver-base-migration.md`](../../decisions/017-linuxserver-base-migration.md) (why we're on the LinuxServer base) and [`docs/decisions/026-editor-default-theme.md`](../../decisions/026-editor-default-theme.md) (Machine-settings theme seeding).

---

## Background — verified findings

These were confirmed hands-on against a real `vscodium-reh-web-linux-x64-1.126.04524` tarball on 2026-08-24. Do not re-litigate them; do re-verify anything that fails in practice.

**Why we're moving:**
- `gitpod-io/openvscode-server` last released `1.109.5` on 2026-02-20. Upstream VS Code stable is 1.134.0.
- LinuxServer deprecated `docker-openvscode-server` on 2026-07-16, citing upstream inactivity, and recommends `code-server` or `vscodium-web`.
- Three High-severity (CVSS 8.8) VS Code RCE advisories were published 2026-08-11 (CVE-2026-70336, CVE-2026-69320, CVE-2026-59113). Exact patched-version boundaries are not in GitHub's advisory DB, so treat the precise cutoffs as unconfirmed; the structural point — a frozen 1.109.5 receives nothing — is what matters.

**Why VSCodium reh-web over code-server:**
- `codium-server` supports `--server-base-path`; `code-server` does not (its `patches/base-path.diff` states plainly: *"All paths must be relative in order to work behind a reverse proxy since we do not know the base path."*). Choosing code-server would mean rewriting the proxy to strip the prefix. VSCodium preserves the existing contract exactly.
- VSCodium releases every ~3.5–7 weeks, jumping 4–5 minor versions each time. At a 2–3× per year base-image bump cadence that is comfortably current.

**Verified working on VSCodium 1.126.04524:**
- `codium-server --server-base-path /u/test-slug/vscode/` serves the workbench and emits absolute asset URLs prefixed with the base path (e.g. `/u/test-slug/vscode/stable-<sha>/static/out/...`).
- WebSocket upgrade under the base path returns `101 Switching Protocols`.
- `?folder=<path>` opens the folder.
- `--install-extension <path-to.vsix> --extensions-dir <dir>` sideloads local VSIX files. Both `wpilibsuite.vscode-wpilib@2026.1.1` and `redhat.java@1.38.0` installed cleanly.
- `--server-data-dir <dir>` produces `<dir>/data/User/` and `<dir>/data/Machine/` — identical to today's layout.
- **Flag caveat — the one gap between evidence and script:** the spike exercised `--server-data-dir`; the run script instead passes `--user-data-dir "${HOME}/data"` to mirror the current openvscode-server invocation. If `codium-server` ignores `--user-data-dir`, settings land at `/config/data/data/{User,Machine}` and the theme/vmargs seeding silently misses. Task 3 Step 5 catches this; the fix, if it bites, is switching the run script to `--server-data-dir "${HOME}"` (that flag takes the *parent* of `data/`).
- Headless Chromium against the workbench rendered the real `robot-starter` tree, activated `redhat.java` (its `Java: Lightweight Mode` status item appeared), with **zero failed requests and zero console errors**.
- `--accept-server-license-terms` is **not** required (that flag belongs to Microsoft's proprietary server build).
- `nc` is present in the base image — LinuxServer's own `svc-vscodium-web/run` uses `nc -z` for its readiness check, so the existing `s6-notifyoncheck` pattern works.

**Known open risk (drives Task 4):** the smoke test opened in **Restricted Mode** (VS Code workspace trust), which holds `redhat.java` in Lightweight Mode and blocks a full Gradle project import. The repo has no workspace-trust configuration anywhere (`grep` over `catalog/`, `containers/`, `apps/control/src` returns nothing). This is not VSCodium-specific — it would behave identically on any of these servers — but it is exactly what a "the migration broke Java" report would look like. Task 4 verifies and, only if needed, fixes it.

## Global Constraints

- **Stack rule:** all non-container code is TypeScript on Bun. Do not introduce another runtime or package manager.
- **Pin the base image exactly:** `linuxserver/vscodium-web:1.126.04524-ls35`. Never use `latest`.
- **Keep the editor on container port 3000.** LinuxServer's image exposes 8000; we override the run script anyway, so passing `--port 3000` means `VSCODE_CONTAINER_PORT`, the port ranges, and the whole control plane need no changes. Do not "fix" this to 8000.
- **Do not modify `apps/control/src/app/proxy.ts`, `converters.ts`, `local-docker-runtime-provider.ts`, or `runtime.ts`.** The pass-through proxy contract is preserved deliberately. If you believe one needs changing, stop and escalate — it means an assumption above is wrong.
- **Never edit applied migrations.** `apps/control/migrations/004_v2_code_container.sql` mentions openvscode-server; it is a historical record. Leave it alone.
- **Preserve LinuxServer conventions:** `abc` user, `PUID`/`PGID`, `lsiown`, `HOME=/config`. These are load-bearing (decision 017).
- **Run `bun run check:fix`** before finalizing any code change. `bun run verify` gates on `biome ci`.
- **Docs:** user/operator docs live in `docs/` (published via Docusaurus). Decision logs live in `docs/decisions/` and are excluded from the site, as is `docs/superpowers/`.
- **Next decision log number is 036.** `035-multi-arch-images-and-workflow-split.md` already exists on `main` (the plan originally assumed 035; the log landed as 036 after merging main).

## File Structure

**Created:**
- `containers/code/root/etc/s6-overlay/s6-rc.d/svc-vscodium-web/run` — editor launch script (replaces the openvscode-server one)
- `containers/code/root/etc/s6-overlay/s6-rc.d/svc-vscodium-web/dependencies.d/init-frc-setup` — empty marker file ordering the editor after FRC setup
- `docs/decisions/036-vscodium-web-migration.md` — decision record

**Deleted:**
- `containers/code/root/etc/s6-overlay/s6-rc.d/svc-openvscode-server/` — entire directory. **Mandatory**: leaving it behind creates a service dir with a `run` but no `type` (the base image no longer supplies one), which fails s6-rc compilation at container start.

**Modified:**
- `containers/code/Dockerfile` — base image, chmod path, extension-install binary path
- `apps/control/src/__tests__/containers.test.ts:298-313` — s6 service script assertion
- `apps/control/src/__tests__/proxy.test.ts` — cosmetic upstream marker string
- `apps/control/src/app/workspace-routes.ts:223-227` — comment naming the editor
- `e2e/fixtures/fake-vscode.ts:2` — comment naming the editor
- `containers/code/root/etc/s6-overlay/s6-rc.d/init-frc-setup/run` — Task 2 scopes the boot-time `lsiown`; Task 4 additionally adds the trust setting **only if its verification fails**
- `THIRD_PARTY_NOTICES.md`, `docs/legal/licenses.md`, `README.md`, `containers/code/README.md`, `.env.example`, and 9 `docs/` pages — attribution and naming

**Deliberately untouched:** `apps/control/src/app/proxy.ts`, `apps/control/src/containers/*`, `containers/code/start-sim.sh`, `run-sim.sh`, `stop-sim.sh` (they key off `HOME=/config`, which does not move), and every `.vscode/settings.json` in `catalog/`.

---

### Task 1: Swap the base image and editor launch

**Files:**
- Create: `containers/code/root/etc/s6-overlay/s6-rc.d/svc-vscodium-web/run`
- Create: `containers/code/root/etc/s6-overlay/s6-rc.d/svc-vscodium-web/dependencies.d/init-frc-setup`
- Delete: `containers/code/root/etc/s6-overlay/s6-rc.d/svc-openvscode-server/` (recursively)
- Modify: `containers/code/Dockerfile` (lines 6, ~62, ~122)
- Modify: `apps/control/src/app/workspace-routes.ts:223-227`, `e2e/fixtures/fake-vscode.ts:2`, `apps/control/src/__tests__/proxy.test.ts`
- Test: `apps/control/src/__tests__/containers.test.ts:298-313`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a workspace image whose editor binary is `/app/vscodium-web/bin/codium-server`, listening on container port 3000, honoring the `VSCODE_BASE_PATH` env var via `--server-base-path`, with extensions at `/config/extensions` and user data at `/config/data`. Tasks 3–5 depend on all of those exact values.

- [x] **Step 1: Update the failing test**

In `apps/control/src/__tests__/containers.test.ts`, replace the test at line 298 in full:

```typescript
	test("s6 service script launches codium-server as primary process", async () => {
		const serviceScript = await readFile(
			join(
				process.cwd(),
				"containers",
				"code",
				"root",
				"etc",
				"s6-overlay",
				"s6-rc.d",
				"svc-vscodium-web",
				"run",
			),
			"utf8",
		);
		expect(serviceScript).toContain("/app/vscodium-web/bin/codium-server");
		expect(serviceScript).toContain("--server-base-path");
	});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bun test apps/control/src/__tests__/containers.test.ts -t "codium-server"`

Expected: FAIL with `ENOENT: no such file or directory` for the `svc-vscodium-web/run` path.

- [x] **Step 3: Create the new s6 service directory**

```bash
cd /home/matt/dev/CodeRunner
mkdir -p containers/code/root/etc/s6-overlay/s6-rc.d/svc-vscodium-web/dependencies.d
touch containers/code/root/etc/s6-overlay/s6-rc.d/svc-vscodium-web/dependencies.d/init-frc-setup
cat > containers/code/root/etc/s6-overlay/s6-rc.d/svc-vscodium-web/run <<'EOF'
#!/usr/bin/with-contenv bash
# shellcheck shell=bash
# Launches codium-server (VSCodium reh-web) as the abc user.
#
# Port 3000 is deliberate: the LinuxServer base exposes 8000, but keeping 3000
# means VSCODE_CONTAINER_PORT and the control plane need no changes.

EXTENSIONS_DIR="${HOME}/extensions"
DATA_DIR="${HOME}/data"

codium_args=(
  --host 0.0.0.0
  --port 3000
  --without-connection-token
  --disable-telemetry
  --extensions-dir "${EXTENSIONS_DIR}"
  --user-data-dir "${DATA_DIR}"
)

if [[ -n "${VSCODE_BASE_PATH:-}" && "${VSCODE_BASE_PATH:-/}" != "/" ]]; then
  codium_args+=(--server-base-path "${VSCODE_BASE_PATH}")
fi

exec \
  s6-notifyoncheck -d -n 300 -w 1000 -c "nc -z 127.0.0.1 3000" \
    cd /app/vscodium-web s6-setuidgid abc \
      /app/vscodium-web/bin/codium-server \
        "${codium_args[@]}" \
        /workspace/project
EOF
```

- [x] **Step 4: Delete the old service directory**

```bash
rm -rf containers/code/root/etc/s6-overlay/s6-rc.d/svc-openvscode-server
```

Verify only the new one remains:

```bash
find containers/code/root -type f | sort
```

Expected output — exactly these seven paths:

```
containers/code/root/etc/s6-overlay/s6-rc.d/init-frc-setup/dependencies.d/init-config-end
containers/code/root/etc/s6-overlay/s6-rc.d/init-frc-setup/run
containers/code/root/etc/s6-overlay/s6-rc.d/init-frc-setup/type
containers/code/root/etc/s6-overlay/s6-rc.d/init-frc-setup/up
containers/code/root/etc/s6-overlay/s6-rc.d/svc-vscodium-web/dependencies.d/init-frc-setup
containers/code/root/etc/s6-overlay/s6-rc.d/svc-vscodium-web/run
containers/code/root/etc/s6-overlay/s6-rc.d/user/contents.d/init-frc-setup
```

(The `dependencies.d/init-frc-setup` marker under `svc-vscodium-web` and the `user/contents.d` marker are both empty files.)

- [x] **Step 5: Update the Dockerfile base image**

In `containers/code/Dockerfile`, replace the header comment block and `FROM` line:

```dockerfile
# V2 merged code container
# Layers JDK 17 + Gradle/WPILib cache + FRC extensions on linuxserver/vscodium-web
# Base already provides: codium-server (VSCodium reh-web), s6-overlay, abc user,
# PUID/PGID support. See docs/decisions/017-linuxserver-base-migration.md and
# docs/decisions/036-vscodium-web-migration.md
FROM linuxserver/vscodium-web:1.126.04524-ls35
```

- [x] **Step 6: Update the Dockerfile chmod and extension-install paths**

Replace the `chmod` line so it targets the renamed service:

```dockerfile
RUN chmod +x /etc/s6-overlay/s6-rc.d/init-frc-setup/run \
             /etc/s6-overlay/s6-rc.d/svc-vscodium-web/run
```

Then replace the editor binary in the extension-install step (the `RUN mkdir -p /opt/frc-extensions-cache && ...` block). Change only the binary path — every `--install-extension` line and `--extensions-dir /opt/frc-extensions-cache` stay exactly as they are:

```dockerfile
    && /app/vscodium-web/bin/codium-server \
```

- [x] **Step 7: Update the stale code comments**

`apps/control/src/app/workspace-routes.ts` — replace the comment block above the editor route (line 223):

```typescript
	// --- Editor proxy: codium-server (VSCodium reh-web) ---
	// Match /vscode or /vscode/* (the suffix starts with /vscode).
	// The full URL path including /u/<slug>/vscode/ is passed through
	// unchanged because codium-server is launched with
	// --server-base-path /u/<slug>/vscode/.
```

`e2e/fixtures/fake-vscode.ts` — line 2:

```typescript
 * In-process HTTP+WS server that impersonates the workspace editor.
```

`apps/control/src/__tests__/proxy.test.ts` — replace both occurrences of the marker string `"openvscode-test"` with `"codium-test"` (there is one in the fake upstream's response header and one in the matching assertion; `sed -i 's/openvscode-test/codium-test/g'` on that file is safe).

- [x] **Step 8: Run the test to verify it passes**

Run: `bun test apps/control/src/__tests__/containers.test.ts -t "codium-server"`

Expected: PASS.

- [x] **Step 9: Lint and format**

Run: `bun run check:fix`

Expected: exits 0, may reformat touched TypeScript.

- [x] **Step 10: Commit**

```bash
git add containers/code apps/control/src/__tests__ apps/control/src/app/workspace-routes.ts e2e/fixtures/fake-vscode.ts
git commit -m "feat(workspace): swap editor to VSCodium reh-web via linuxserver/vscodium-web"
```

---

### Task 2: Scope `init-frc-setup`'s ownership pass to what it actually creates

**Why this rides with the migration:** `init-frc-setup` currently ends with `lsiown -R abc:abc "${HOME}"` — a full recursive traversal of `/config`, including the ~1 GB seeded Gradle cache, on **every** boot. The base image's own init (`init-vscodium-web`, checked against `linuxserver/docker-vscodium-web` `main` on 2026-08-24) already chowns `/config` recursively each boot, so our pass exists only to fix ownership of files this script itself creates as root: the first-boot seed copies, plus the settings files written via `mktemp`+`mv`, which arrive root-owned with mode 600. Decision 033's incident mode is exactly this class of redundant read traffic, and the fix touches the same file Task 4 may edit anyway.

**Files:**
- Modify: `containers/code/root/etc/s6-overlay/s6-rc.d/init-frc-setup/run`

**Interfaces:**
- Consumes: nothing from Task 1 beyond the service layout (this script's path does not change).
- Produces: an init that recursively chowns the seed trees only on first boot and otherwise touches only the specific files it writes. Task 3 Step 5b verifies ownership comes out right in the built image.

- [x] **Step 1: Chown the seed trees inside the first-boot branches**

Add a scoped `lsiown -R` to each seed branch, so the expensive recursion runs only when the copy actually happened:

```bash
# Seed Gradle cache on first run.
if [[ -d /opt/frc-gradle-cache && ! -d "${GRADLE_USER_HOME}/caches" ]]; then
  echo "Seeding Gradle cache from image..."
  cp -a /opt/frc-gradle-cache/. "${GRADLE_USER_HOME}"/
  lsiown -R abc:abc "${GRADLE_USER_HOME}"
fi

# Seed extensions on first run.
if [[ -d /opt/frc-extensions-cache ]] && [[ -z "$(ls -A "${EXTENSIONS_DIR}" 2>/dev/null)" ]]; then
  echo "Seeding VS Code extensions from image..."
  cp -a /opt/frc-extensions-cache/. "${EXTENSIONS_DIR}"/
  lsiown -R abc:abc "${EXTENSIONS_DIR}"
fi
```

- [x] **Step 2: Replace the trailing recursive pass with an explicit file list**

Replace the final block:

```bash
# Fix ownership for /config and /workspace (linuxserver convention).
echo "setting permissions::config"
lsiown -R abc:abc "${HOME}"
echo "setting permissions::workspace"
lsiown -R abc:abc /workspace/project
```

with:

```bash
# Fix ownership of what this script created as root. The base image's init
# already chowns /config recursively every boot — do not reintroduce a second
# recursive pass over ${HOME}; the Gradle cache alone is ~1 GB of traversal
# (decision 033).
echo "setting permissions::config"
lsiown abc:abc \
  "${GRADLE_USER_HOME}" "${EXTENSIONS_DIR}" \
  "${HOME}/data" "${HOME}/data/Machine" "${HOME}/data/User" \
  "${GRADLE_PROPERTIES}" "${USER_SETTINGS}" "${MACHINE_SETTINGS}" \
  "${SIM_LOG_FILE}"
echo "setting permissions::workspace"
lsiown -R abc:abc /workspace/project
```

Keep the `/workspace/project` recursion — the bind mount is where UID migration for pre-existing student files still matters, and the project-settings merge writes there. Pre-existing wrong-UID files under `/config` (e.g. after a PUID change) are covered by the upstream init, which runs before this one.

- [x] **Step 3: Sanity-check and commit**

Run: `bun run test` — the `code-container-defaults` and `containers` suites read this script and must still pass.

```bash
git add containers/code/root/etc/s6-overlay/s6-rc.d/init-frc-setup/run
git commit -m "perf(workspace): scope init-frc-setup ownership fix to files it creates"
```

---

### Task 3: Build the image and verify the editor serves under the base path

**Files:** none modified — this task's deliverable is a built, verified image plus recorded evidence.

**Interfaces:**
- Consumes: the image produced by Tasks 1–2, and its guarantees (port 3000, `VSCODE_BASE_PATH` → `--server-base-path`, extensions at `/config/extensions`, user data at `/config/data`).
- Produces: confidence that the proxy contract holds. Task 4 reuses the running `cr-smoke` container.

- [x] **Step 1: Build the workspace image**

Run: `bun run docker:build:workspace`

Expected: build succeeds. It is slow — the Gradle/WPILib cache priming runs a full `./gradlew build`. Note the tag it prints; the default is `docker.io/bobcatrobotics/coderunner-workspace:latest` unless `CODE_IMAGE` or `CODERUNNER_TAG` is set. Use that tag as `$IMAGE` below.

- [x] **Step 2: Start a throwaway container against a scratch project**

```bash
IMAGE=docker.io/bobcatrobotics/coderunner-workspace:latest
rm -rf /tmp/cr-smoke
cp -a catalog/modules/robot-starter /tmp/cr-smoke
rm -rf /tmp/cr-smoke/build /tmp/cr-smoke/.gradle
docker rm -f cr-smoke 2>/dev/null
docker run -d --name cr-smoke \
  -e VSCODE_BASE_PATH=/u/smoke/vscode/ \
  -e PUID="$(id -u)" -e PGID="$(id -g)" \
  -p 127.0.0.1:33999:3000 \
  --mount type=bind,src=/tmp/cr-smoke,dst=/workspace/project \
  "$IMAGE"
sleep 45
docker logs cr-smoke | tail -20
```

Expected: logs show the FRC init seeding Gradle cache and extensions, then `Web UI available at http://localhost:3000/u/smoke/vscode/`.

Copying to `/tmp` first is deliberate — bind-mounting `catalog/` directly would let the container write build output into the repo.

- [x] **Step 3: Verify the workbench serves under the base path with prefixed assets**

```bash
curl -s http://127.0.0.1:33999/u/smoke/vscode/ | grep -oE '/u/smoke/vscode/stable-[a-f0-9]+/static/out/vs/code/browser/workbench/workbench\.js'
```

Expected: prints the matching path. An empty result means asset URLs are not being prefixed — stop and escalate, the base-path contract is broken.

- [x] **Step 4: Verify WebSocket upgrade under the base path**

```bash
curl -s -i --max-time 5 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: $(head -c16 /dev/urandom | base64)" \
  -H "Sec-WebSocket-Version: 13" \
  "http://127.0.0.1:33999/u/smoke/vscode/?reconnectionToken=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&reconnection=false&skipWebSocketFrames=false" \
  | head -1
```

Expected: `HTTP/1.1 101 Switching Protocols`

- [x] **Step 5: Verify extensions and settings were seeded**

```bash
docker exec cr-smoke ls /config/extensions
docker exec cr-smoke cat /config/data/Machine/settings.json
docker exec cr-smoke cat /config/data/User/settings.json
```

Expected: the extensions listing includes `redhat.java-1.38.0` and `wpilibsuite.vscode-wpilib-2026.1.1`; Machine settings contain `"workbench.colorTheme": "Default Dark Modern"`; User settings contain the `java.jdt.ls.vmargs` and Gradle keys from `init-frc-setup`.

If the settings files are missing and a `/config/data/data/` directory exists, `codium-server` ignored `--user-data-dir` (see the flag caveat in Background): switch the run script to `--server-data-dir "${HOME}"`, rebuild, and repeat this task.

> **Actual:** the `--user-data-dir` caveat was recorded as "did not occur" — `/config/data/data/` does not exist, and both settings files are present with the expected content. **Post-review correction (2026-08-26): the caveat DID occur.** `/config/data/data/` was the wrong sentinel (that path presumed the server treated `--user-data-dir` as a server-data-dir); the real miss path was `/config/.vscodium-server/data/`, and the settings files were present because `init-frc-setup` writes them, not because the server read them. The run script now passes `--server-data-dir "${HOME}"` as this caveat prescribed — see decision 036's post-review correction section. `wpilibsuite.vscode-wpilib-2026.1.1` matched exactly. But `redhat.java` installed as `redhat.java-1.55.0-linux-x64`, not the expected `1.38.0` — along with three other pinned extensions at newer versions (`vscjava.vscode-gradle` 3.18.0 vs pinned 3.17.3, `vscjava.vscode-java-dependency` 0.27.6 vs 0.27.2, `vscjava.vscode-java-test` 0.46.0 vs 0.45.0). Cause (isolated later, not fixed): installing the `vscjava.vscode-java-pack` VSIX makes the editor fetch all six pack members from Open VSX at latest, overwriting the pinned installs. Confirmed pre-existing on the old openvscode-server image too — not a migration regression. See decision 036's Consequences section and the plan's Follow-up #2.

- [x] **Step 5b: Verify ownership after the scoped lsiown (Task 2)**

```bash
docker exec cr-smoke stat -c '%U:%G %n' /config/.gradle /config/extensions \
  /config/data/User/settings.json /config/data/Machine/settings.json /config/sim.log
```

Expected: every line reports `abc:abc`.

- [x] **Step 6: Verify the JDK and sim scripts still work**

```bash
docker exec cr-smoke java -version
docker exec cr-smoke ls -l /usr/local/bin/start-sim.sh /usr/local/bin/run-sim.sh /usr/local/bin/stop-sim.sh
```

Expected: `openjdk version "17.0.15"`; all three scripts present and executable.

- [x] **Step 7: Record the evidence**

Paste the outputs of Steps 3–6 into the task's completion notes. Task 7 cites them in the decision log. Leave `cr-smoke` running for Task 4.

---

### Task 4: Verify Java reaches Standard Mode; fix workspace trust only if it does not

**Files:**
- Modify (conditionally): `containers/code/root/etc/s6-overlay/s6-rc.d/init-frc-setup/run`

**Interfaces:**
- Consumes: the running `cr-smoke` container from Task 3.
- Produces: either a confirmed-good Java path, or an `init-frc-setup` that seeds `security.workspace.trust.enabled: false` into **User** settings. That setting is `application`-scoped in VS Code, so it cannot live in Machine or Workspace settings — User is the only scope that takes effect.

- [x] **Step 1: Open the workbench in a browser**

Open `http://127.0.0.1:33999/u/smoke/vscode/?folder=/workspace/project`.

> **Actual:** done via headless Chromium (Playwright), not a manual browser — same URL and folder param.

- [x] **Step 2: Observe the Java status item**

Watch the status bar. `redhat.java` starts in `Java: Lightweight Mode` and should transition to `Java: Standard Mode` (or show a build/import progress notification) within roughly 1–3 minutes, since the Gradle cache is primed.

> **Actual:** it did not transition. Polled every 20s for a full 3 minutes; status bar showed `Restricted Mode` + `Java: Lightweight Mode` on all 9 polls, no import progress ever appeared.

- [x] **Step 3: Decide the branch**

- **Standard Mode reached, and opening `src/main/java/frc/robot/Robot.java` gives completions on WPILib types** → workspace trust is not blocking anything. Skip Steps 4–7, go to Step 8.
- **Stuck in Lightweight Mode, or the window shows "Restricted Mode"** → continue to Step 4.

> **Actual:** the second branch — stuck in Lightweight/Restricted Mode.

- [x] **Step 4: Confirm the cause before changing anything**

```bash
docker exec cr-smoke sh -c 'cat /config/data/User/settings.json'
```

Then, in the browser, click **Manage** on the Restricted Mode banner and choose to trust the folder. If Java then reaches Standard Mode, workspace trust is confirmed as the cause. Proceed to Step 5. If it does **not**, stop — the problem is something else and this plan's assumption is wrong; escalate rather than applying an unrelated fix.

> **Actual:** confirmed. `settings.json` had no `security.workspace.trust.enabled` key. Clicking Trust (via Playwright) triggered a real Gradle import (visible download progress) and reached `Java: Ready` in ~40s, with a genuine `jdt_ws` workspace created container-side. Workspace trust is unambiguously the cause. Proceeded to test Step 5's fix rather than apply it outright — see below.

- [x] **Step 5: Seed the trust setting in `init-frc-setup` — superseded by decision 037**

The proposed change was to add this line to the defaults branch in
`merge_vscode_settings`:

```bash
      | (if $mode == "project" then . else ."security.workspace.trust.enabled" //= false end)
```

The `//=` keeps this a default only — a student who turns trust back on keeps their choice. The `project` guard keeps it out of `/workspace/project/.vscode/settings.json`, which is student-owned and gets committed to their team repo.

> **Actual: not applied to the repo.** The equivalent key was written directly into the running container's `/config/data/User/settings.json` via `docker exec` + `jq` (not this file) to test the fix cheaply before committing to a rebuild. Result: no effect — tried twice, including once on a completely fresh container with zero prior trust-decision state, and Restricted Mode persisted identically both times. Root cause (investigated read-only, not fixed): `security.workspace.trust.enabled` is read through VS Code's `application`-scoped configuration, which this browser-only deployment does not appear to source from the server-side `settings.json` — the same rule that greys the setting out in Remote-SSH windows. Because the fix as specified does not work, this edit was never made to the actual `init-frc-setup` script. See decision 036 §5 for the full account and candidate alternatives. Decision 037 subsequently closed this with codium-server's `--disable-workspace-trust` flag.

- [x] **Step 6: Rebuild and re-verify — completed by decision 037 acceptance**

```bash
bun run docker:build:workspace
docker rm -f cr-smoke
```

Then repeat Task 3 Step 2 and this task's Steps 1–2.

Expected: no Restricted Mode banner; Java reaches Standard Mode.

> **Actual: not run.** No fix was committed, so no rebuild was needed. The fix was instead re-tested against a freshly recreated `cr-smoke` (Task 3 Step 2's exact recipe, no image rebuild) to rule out contaminated state — see Step 5's note.

- [x] **Step 7: Commit the fix — superseded by the decision 037 implementation**

```bash
git add containers/code/root/etc/s6-overlay/s6-rc.d/init-frc-setup/run
git commit -m "fix(workspace): trust the seeded project so redhat.java leaves Lightweight Mode"
```

> **Actual: not run.** The tested fix doesn't work, so nothing was committed. `init-frc-setup` is unchanged by this task. Comparison against the current production (openvscode-server) image showed the identical Restricted Mode / Lightweight Mode behavior, so this is confirmed pre-existing, not a migration regression — recorded in decision 036 §5 rather than fixed here.

- [x] **Step 8: Tear down the smoke container**

```bash
docker rm -f cr-smoke
rm -rf /tmp/cr-smoke
```

> **Actual:** deliberately deferred at this point, then completed after the follow-up acceptance work. The temporary container and project are gone.

---

### Task 5: Full regression gate

**Files:** none modified. Deliverable is a green suite.

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: proof that the control plane, web shell, and E2E tiers are unaffected — which is the plan's central claim.

- [x] **Step 1: Typecheck**

Run: `bun run typecheck`
Expected: exits 0.

- [x] **Step 2: Lint and format check**

Run: `bun run check`
Expected: exits 0.

- [x] **Step 3: Control-plane tests**

Run: `bun run test`
Expected: all pass (~350 tests). The `svc-vscodium-web` assertion from Task 1 passes here.

- [x] **Step 4: Frontend tests**

Run: `bun run test:web`
Expected: all pass (~80 tests).

- [x] **Step 5: E2E mocked tier**

Run: `bun run e2e`
Expected: all pass (~55 tests). These run against the in-process `ControlApp` with `fake-vscode`, so they exercise the proxy contract without Docker.

- [x] **Step 6: E2E security tier**

Run: `bun run e2e:security`
Expected: all pass (~8 tests).

- [x] **Step 7: Commit only if a test needed adjusting**

If every suite passed with no edits, there is nothing to commit — say so and move on. If a test required a change, commit it alone:

```bash
git add <the test file>
git commit -m "test: update editor naming after VSCodium migration"
```

---

### Task 6: Update license notices and documentation

**Files:**
- Modify: `THIRD_PARTY_NOTICES.md`, `docs/legal/licenses.md`, `README.md:66`, `containers/code/README.md`, `.env.example:112`
- Modify: `docs/about/workspace-container.md`, `docs/about/student-experience.md`, `docs/development/workspace-image.md`, `docs/development/dev-servers.md`, `docs/operating/capacity.md`, `docs/operating/troubleshooting.md`, `docs/reference/configuration.md`, `docs/reference/faq.md`, `docs/index.md`, `docs/legal/terms.md`

**Interfaces:**
- Consumes: the pinned versions from Task 1 (`linuxserver/vscodium-web:1.126.04524-ls35`, VSCodium `1.126.04524`).
- Produces: accurate attribution. The image redistributes VSCodium, so its notice must travel with it — `THIRD_PARTY_NOTICES.md` ships inside the image at `/usr/share/coderunner/`.

- [x] **Step 1: Fetch VSCodium's exact copyright line**

```bash
curl -sS https://raw.githubusercontent.com/VSCodium/vscodium/1.126.04524/LICENSE | head -5
```

Copy the real copyright line from the output. Do not invent one.

- [x] **Step 2: Update the `THIRD_PARTY_NOTICES.md` summary table**

Replace these two rows:

```markdown
| [openvscode-server](https://github.com/gitpod-io/openvscode-server) / Code – OSS | 1.109.5 | MIT | base of the workspace image |
| [linuxserver/openvscode-server](https://github.com/linuxserver/docker-openvscode-server) image | 1.109.5 | GPL-3.0 | base image, unmodified |
```

with:

```markdown
| [VSCodium](https://github.com/VSCodium/vscodium) / Code – OSS | 1.126.04524 | MIT | `reh-web` build, base of the workspace image |
| [linuxserver/vscodium-web](https://github.com/linuxserver/docker-vscodium-web) image | 1.126.04524-ls35 | GPL-3.0 | base image, unmodified |
```

- [x] **Step 3: Update the MIT section heading and attribution**

Rename the `## openvscode-server and Code – OSS` heading to `## VSCodium and Code – OSS`. Keep the existing MIT licence text and its `Copyright (c) 2015 - present Microsoft Corporation` line (Code – OSS is still Microsoft's). Immediately below that copyright line, add VSCodium's own copyright line from Step 1, so both are represented.

- [x] **Step 4: Update the copyleft section**

Replace the `linuxserver/openvscode-server` bullet:

```markdown
- **`linuxserver/vscodium-web` container image** — GNU General Public License v3.0.
  <https://github.com/linuxserver/docker-vscodium-web/blob/main/LICENSE>
```

Note the branch is `main`, not `master`.

- [x] **Step 5: Update `docs/legal/licenses.md`**

Replace the two openvscode-server rows with the VSCodium equivalents, matching the wording used in Step 2.

- [x] **Step 6: Update `containers/code/README.md`**

Replace the intro line:

```markdown
Merged per-student container for V2. Combines VSCodium reh-web (`codium-server`) + Java IDE + WPILib support in a single image using the linuxserver.io base (Ubuntu 24.04, s6-overlay).
```

Replace the two "What's Inside" rows:

```markdown
| Base image | linuxserver/vscodium-web:1.126.04524-ls35 | GPL-3.0 | Ubuntu 24.04, s6-overlay, codium-server, PUID/PGID |
| VSCodium reh-web (`codium-server`) | 1.126.04524 (from base) | MIT | Browser-based VS Code editor |
```

Replace the port table row:

```markdown
| 3000 | codium-server (HTTP + WebSocket) — overrides the base image's 8000 |
```

Replace the s6 supervision paragraph and its first two bullets:

```markdown
The container uses s6-overlay for process supervision. The upstream `linuxserver/vscodium-web` image provides the base services; we add FRC-specific layers:

- **`init-vscodium-web`** (upstream): Creates `/config` dirs, fixes permissions, configures sudo.
- **`svc-vscodium-web`** (upstream, run script overridden): Launches `codium-server` as `abc` user with health check, custom extensions/data dirs, port 3000, and server-base-path.
```

- [x] **Step 7: Update the remaining prose references**

```bash
grep -rn "openvscode" README.md .env.example docs/ | grep -v docs/decisions
```

Work through each hit, replacing the product name with VSCodium / `codium-server` as the sentence requires. In `README.md:66`, also swap the openvscode-server link for `https://github.com/VSCodium/vscodium`.

Leave `docs/decisions/**` untouched — decision logs are historical records.

- [x] **Step 8: Verify no stale references outside decision logs**

```bash
grep -rn "openvscode" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=decisions --exclude-dir=graphify-out . | grep -v "apps/control/migrations/"
```

Expected: no output. The migrations exclusion is deliberate — `004_v2_code_container.sql` must keep its historical wording.

- [x] **Step 9: Confirm the docs site still builds**

Run: `bun run docs:build`
Expected: exits 0.

- [x] **Step 10: Commit**

```bash
git add THIRD_PARTY_NOTICES.md README.md .env.example docs/ containers/code/README.md
git commit -m "docs: retarget editor attribution and naming to VSCodium reh-web"
```

---

### Task 7: Record decision log 036

> **Mostly done already — do not write a second decision log.**
> `docs/decisions/036-vscodium-web-migration.md` was written on 2026-08-24,
> ahead of implementation, and `docs/decisions/README.md` and `AGENTS.md` were
> updated at the same time. Steps 1 and 3 are complete. What remains is Step 1b:
> fill in the verification outcomes once Tasks 3–5 have actually run.

**Files:**
- Modify: `docs/decisions/036-vscodium-web-migration.md` (already exists)

**Interfaces:**
- Consumes: the evidence recorded in Task 3 Step 7 and the Task 4 branch outcome.
- Produces: the durable rationale. AGENTS.md requires a decision log for non-obvious tooling choices, and "why not code-server" is exactly the question a future maintainer will ask.

- [x] **Step 1: Write the decision log** — done 2026-08-24. For reference, it covers:

- **Context:** openvscode-server's last release was 1.109.5 on 2026-02-20; LinuxServer deprecated `docker-openvscode-server` on 2026-07-16 citing upstream inactivity; three High-severity VS Code RCE advisories landed 2026-08-11 that a frozen build can never receive.
- **Decision — VSCodium reh-web over code-server:** `codium-server` supports `--server-base-path`, so the control plane's pass-through proxy is preserved verbatim. code-server has no such flag and expects a prefix-stripping proxy, which would have meant rewriting `proxy.ts`, `converters.ts`, and the provider. Quote its `patches/base-path.diff`: *"All paths must be relative in order to work behind a reverse proxy since we do not know the base path."*
- **Decision — stay on the LinuxServer base:** preserves decision 017's s6/PUID/PGID/`lsiown`/`/config` model, so the Dockerfile diff stays small.
- **Decision — keep port 3000:** the base image exposes 8000; overriding the run script to 3000 means zero control-plane changes.
- **Accepted risk:** `linuxserver/vscodium-web` had ~28.5k Docker Hub pulls versus ~780k for the deprecated openvscode-server image, and is ~8 months old. If LinuxServer drops it, the fallback is installing the `vscodium-reh-web-linux-x64` tarball onto `linuxserver/baseimage-ubuntu:noble` directly — roughly 10 lines of Dockerfile plus four s6 files. Record this so the fallback is not re-derived under pressure.
- **Accepted risk:** VSCodium releases every ~3.5–7 weeks in 4–5 minor-version jumps, so each base bump crosses a wider delta than openvscode-server's old monthly cadence. Budget a smoke test per bump.
- **Verification:** the evidence from Task 3 Steps 3–6 and the Task 4 outcome.
- **Workspace trust:** record whichever branch Task 4 took, and why the setting must live in User scope (it is `application`-scoped).

- [x] **Step 1b: Fill in the verification outcomes**

The log currently states what was verified in the pre-implementation spike and
flags Standard Mode as deferred. Update two places with real results:

- **"What was verified, and what was not"** — replace the deferred paragraph
  with the Task 4 outcome: whether `redhat.java` reached Standard Mode in the
  built image, and whether WPILib type completions worked.
- **"Open question: workspace trust"** — record which Task 4 branch was taken.
  If the trust setting was added, change the heading from "Open question" to a
  numbered decision under `## Decision` and state that it was confirmed
  necessary. If Java reached Standard Mode without it, say so and note the
  section is retained as a diagnosis aid.

Also re-check the AGENTS.md re-verification consequence: once Task 4 confirms
auto-import on completion and Ctrl-click into library source still behave, note
that in the log so 011's evidence has an explicit successor.

> **Actual at migration acceptance:** neither of the two anticipated branches
> occurred — Standard Mode was never reached without a manual trust click, and
> the trust-setting fix was tested and found not to work (see Task 4's step
> notes above). The later decision 037 server flag fixed trust without a patch,
> and the post-acceptance Gradle argument correction removed the Buildship sync
> blocker. The three decision-011 editor interactions now live in the reusable
> workspace-image acceptance checklist rather than as an open implementation
> follow-up.

- [x] **Step 2: Confirm it is excluded from the published site** — done 2026-08-24. `bun run docs:build` exits 0; `decisions/` and `superpowers/` produce no routes in `website/build/`. Re-run after editing:

```bash
bun run docs:build && grep -rl "vscodium-web-migration" website/build | head
```

Expected: build exits 0, grep prints nothing.

- [x] **Step 3: Update AGENTS.md's decision-log range** — done 2026-08-24 (`011–029` → `011–035`; it was already stale). `docs/decisions/README.md` was updated in the same pass.

- [x] **Step 4: Commit**

```bash
git add docs/decisions/036-vscodium-web-migration.md docs/decisions/README.md AGENTS.md docs/superpowers/ website/docusaurus.config.ts
git commit -m "docs: record decision 036 — VSCodium reh-web editor migration"
```

---

## Out of scope

Do not bundle these in. They are real but separate, and mixing them makes the migration harder to review or revert:

- **Bumping any bundled extension version.** Every `ARG *_VERSION` in the Dockerfile stays pinned exactly as-is. Changing an extension version at the same time as the editor would make any regression ambiguous.
- **Switching to `code-server`, or to the raw tarball on `baseimage-ubuntu`.** Both were evaluated and rejected; we stay on the LinuxServer base. The tarball route is documented in decision 036 as the fallback if LinuxServer deprecates `vscodium-web`.
- **The review findings listed below.** They were deliberately kept out of the
  migration commit and resolved in the subsequent acceptance work recorded by
  the disposition section.

## Follow-up disposition (closed 2026-08-26)

The senior-review findings were handled after migration acceptance:

1. **Closed — duplicate Gradle layers removed.** The build now primes directly
   into `/opt/frc-gradle-cache` with a RUN-scoped `GRADLE_USER_HOME`, performs
   build and cleanup in one layer, and uses `COPY --chown` for the catalog. The
   runtime `GRADLE_USER_HOME=/config/.gradle` contract is unchanged.
2. **Closed as retained — Java Pack and Maven.** Decision 037 keeps the Java
   Extension Pack for its commands, walkthroughs, formatter/classpath UI, and
   Gradle Install New JDK integration. Maven remains one of that pack's declared
   members. Exact pinned local-VSIX verification prevents either from causing
   gallery drift.
3. **Closed — Spotless re-sourced.** Open VSX has no artifact and the publisher
   attaches no VSIX to GitHub releases, so a throwaway Docker stage builds
   version 1.2.1 from its pinned MIT-licensed publisher source commit. No
   Marketplace artifact is downloaded or redistributed.
4. **Closed — redundant CRLF scrubbing removed.** Build-time scrubs of tracked
   files are gone; the runtime scrub for student-imported `gradlew` files stays.
5. **Closed as retained — legacy JDT vmargs migration.** Public team imports can
   continue to introduce WPILib settings containing `-Xmx8G` or `-Xmx2G`, so
   this is an ongoing container memory-safety compatibility shim, not only a
   migration for workspaces that existed before decision 024.
6. **Closed as accepted — upstream recursive chown retained.** Decision 034
   measured the cost and records why it remains necessary: the control plane's
   simulation exec path runs as root and can leave root-owned Gradle entries.
   Demo mode's named `/config` volume bounds the affected-platform cost. Revisit
   only if simulation execution first moves to `abc`.
