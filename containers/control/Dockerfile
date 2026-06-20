# CodeRunner control plane
#
# Multi-stage build that produces a self-contained image: Bun runtime, control
# plane source, production node_modules, web shell dist, AdvantageScope Lite
# dist, bundled lesson catalog, migrations, and ops scripts. The emscripten
# (emsdk) toolchain needed to compile AdvantageScope's wasm lives only in a
# build stage — neither CI runners nor operators install it.
#
# Build context is the repo root (like containers/code/Dockerfile) and needs
# the vendor/AdvantageScope submodule initialized:
#   docker build -f containers/control/Dockerfile -t coderunner-control .
#
# See docs/decisions/031-containerized-control-plane.md.

ARG BUN_VERSION=1.3.13

# ── Stage 1: web shell build ───────────────────────────────────────────
FROM oven/bun:${BUN_VERSION} AS web-build
WORKDIR /repo

# Workspace manifests first so the install layer caches across src changes.
COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/control/package.json apps/control/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN bun install --frozen-lockfile

COPY packages/ packages/
COPY apps/web/ apps/web/
RUN bun run build:web

# ── Stage 2: AdvantageScope Lite build (emsdk) ─────────────────────────
# emscripten/emsdk ships the pinned wasm toolchain with EMSDK/EM_CONFIG
# preset. AdvantageScope's compile tooling wants a modern Node, so install
# Node 24 (matching CI) ahead of emsdk's bundled runtime on PATH, plus a
# pinned Bun for the build scripts.
FROM emscripten/emsdk:4.0.12 AS ascope-build
ARG BUN_VERSION
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends curl ca-certificates unzip \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun

WORKDIR /repo
# build-ascope-lite.ts resolves checked-in symlinks from git blobs and
# apply-ascope-patches.ts runs `git apply`, both via `git -C
# vendor/AdvantageScope`. The submodule worktree carries a gitfile pointing at
# .git/modules/vendor/AdvantageScope, so copy that gitdir alongside it (and
# only it — copying all of .git would bust this layer's cache on every
# commit).
COPY .git/modules/vendor/AdvantageScope/ .git/modules/vendor/AdvantageScope/
COPY vendor/ vendor/
COPY patches/ patches/
COPY scripts/ scripts/
RUN git config --global --add safe.directory '*'
# /usr/bin first so the nodesource node/npm win over emsdk's bundled runtime;
# the wasm step re-prepends the emsdk paths itself (envWithEmsdk).
RUN PATH="/usr/bin:${PATH}" bun scripts/build-ascope-lite.ts

# ── Stage 3: dist export (CI only) ─────────────────────────────────────
# A filesystem-only stage holding just the built web shell + AdvantageScope
# Lite dists. CI builds this with `--target dist-export --output type=local`
# to harvest the release tarballs (web-dist/ascope-dist) straight from the
# build cache — no need to load the full runtime image into the daemon. It
# shares every upstream layer with the runtime stage, so with a warm cache it
# costs ~nothing. Not referenced by a plain `docker build` (runtime is the
# default last stage), so local builds are unaffected.
FROM scratch AS dist-export
COPY --from=web-build /repo/apps/web/dist /web-dist
COPY --from=ascope-build /repo/dist/advantagescope /ascope-dist

# ── Stage 4: runtime (default build target) ────────────────────────────
FROM oven/bun:${BUN_VERSION}

# Docker CLI only — the daemon is the host's, reached through the bind-mounted
# /var/run/docker.sock (docker-out-of-docker; workspace containers are
# siblings). curl serves the compose healthcheck.
COPY --from=docker:27.5.1-cli /usr/local/bin/docker /usr/local/bin/docker
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Install with the workspace source present: bun's isolated linker creates the
# per-workspace node_modules (apps/control/node_modules, etc.) that the control
# plane resolves dependencies through. A manifests-only install leaves the
# workspace deps in the .bun store but unlinked, so the runtime can't find
# @logtape/better-auth/prom-client. --production drops the dev toolchain.
COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ packages/
COPY apps/control/ apps/control/
COPY scripts/ scripts/
RUN bun install --frozen-lockfile --production
COPY catalog/ catalog/
COPY --from=web-build /repo/apps/web/dist apps/web/dist
COPY --from=ascope-build /repo/dist/advantagescope dist/advantagescope

# /data is the bind-mounted host data directory (SQLite DB + per-student
# projects). The ops scripts' relative "data" fallbacks rely on these being
# set, so keep them even though compose usually repeats them.
ENV FRC_DATA_DIR=/data \
    FRC_DB_PATH=/data/app.db \
    NODE_ENV=production

EXPOSE 4000

# Migrate-then-serve, with exec so the control plane is PID 1 and receives
# docker stop's SIGTERM directly.
ENTRYPOINT ["/bin/sh", "-c", "bun apps/control/src/migrate.ts apply && exec bun apps/control/src/main.ts"]
