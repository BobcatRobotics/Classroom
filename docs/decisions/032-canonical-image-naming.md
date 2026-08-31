# 032 — Canonical Image Naming

## Status

Accepted.

## Context

The docker build/pull steps were bolted on at different development stages and
disagreed on what the images are called:

- The workspace build script tagged only the bare name `coderunner-workspace`,
  while docker compose referenced `docker.io/bobcatrobotics/coderunner-workspace:${CODERUNNER_TAG:-latest}`
  — so a local rebuild was invisible to `docker compose up`.
- The control build was an inline one-liner tagging both a bare name and the
  GHCR name; the workspace build tagged neither GHCR name.
- `docker:pull:workspace` pulled the GHCR image and then `docker tag`ged it to
  the bare name, purely to satisfy the control plane's bare-name `CODE_IMAGE`
  default.
- `docker:push:workspace` built the bare tag but pushed the GHCR tag — two
  potentially different images.

The bare names existed to keep the from-source path repo-agnostic (a fork
shouldn't hardcode `mathewdunne`), but the compose file hardcoded the
namespace anyway, so forks already had to edit it.

## Decision

One canonical, registry-qualified name per image, used identically by the
build script, the pull script, docker compose, and the control plane's
`CODE_IMAGE` default:

```
${CODERUNNER_IMAGE_NS:-docker.io/bobcatrobotics}/coderunner-control:${CODERUNNER_TAG:-latest}
${CODERUNNER_IMAGE_NS:-docker.io/bobcatrobotics}/coderunner-workspace:${CODERUNNER_TAG:-latest}
```

- **Local builds claim the canonical `:latest` name directly.** Rebuild +
  `docker compose up` (or `bun run dev:control`) uses the local image with no
  re-tag step. The flip side is accepted deliberately: an explicit
  `docker compose pull` / `bun run build` overwrites a local `:latest` with
  the registry version — a pull means "give me the published image".
- **`CODERUNNER_IMAGE_NS` (registry + owner) is the fork knob.** One `.env`
  line covers compose interpolation, `scripts/image.ts`, and the control
  plane's default. CI already derives the owner
  (`docker.io/${{ github.repository_owner }}`), so the release workflow needed
  no change. `CODE_IMAGE` still overrides the workspace name outright.
- **Bare names are gone.** They were shorthand for `docker.io/library/...`
  (the wrong registry), broke `docker compose pull`, and hid image provenance.
  The pull-side `docker tag` rename is deleted with them. Nothing matched
  containers by image name (reconciliation uses `frc-sim.*` labels and the
  `coderunner-workspace-` container-name prefix), so no runtime behavior
  changed.
- **`docker:push:workspace` is deleted.** CI is the sole publisher; the script
  was broken anyway (built one tag, pushed another) and a laptop push can
  desync `:latest` from the released tag.
- **One Bun script for both images.** `scripts/image.ts <build|pull>
  <workspace|control>` replaces `scripts/build-code-image.ts` and the inline
  control build, keeping the name resolution in a single place (repo rule:
  TypeScript on Bun).

## Consequences

- The local-iteration loop is: `bun run docker:build:workspace` (or
  `:control`), then `docker compose up` — no tagging ceremony, no way to run a
  stale image by accident because of a name mismatch.
- `docker images` shows exactly one name per image and where it came from.
- Forks set `CODERUNNER_IMAGE_NS` once instead of editing compose/package.json.
- Anyone holding an old bare-tagged image just rebuilds or re-pulls once;
  the bare tags are simply never produced or read again.
