# Decision Logs

Record active architecture decisions here.

## Active (V2 and post-V2)

011–033 are the current decision logs (see files in this directory). The latest:

- [`031-containerized-control-plane.md`](031-containerized-control-plane.md) — the control plane ships as a Docker image deployed with docker compose; dual-mode container networking, host-path translation, emsdk moved into the build.
- [`032-canonical-image-naming.md`](032-canonical-image-naming.md) — one canonical name per image, derived from `CODERUNNER_IMAGE_NS` + `CODERUNNER_TAG`.
- [`033-workspace-disk-read-limit.md`](033-workspace-disk-read-limit.md) — workspace containers get a per-device `--device-read-bps` cap (`CODE_DISK_READ_LIMIT`) so one memory-thrashing container cannot saturate host disk throughput and freeze the VM; `CODE_MEMORY_LIMIT` default raised to `4096m`.

## Archive

V1 decision logs 007–010 and MVP decision logs 001–006 are archived because V1 is no longer the runtime model and the MVP phase is complete:

- [`archive/001-sim-container.md`](archive/001-sim-container.md)
- [`archive/002-advantagescope-lite-hosting.md`](archive/002-advantagescope-lite-hosting.md)
- [`archive/003-web-shell.md`](archive/003-web-shell.md)
- [`archive/004-backend-wiring.md`](archive/004-backend-wiring.md)
- [`archive/005-java-lsp.md`](archive/005-java-lsp.md)
- [`archive/006-multi-tenancy-findings.md`](archive/006-multi-tenancy-findings.md)
- [`archive/007-v1-sim-container-orchestration.md`](archive/007-v1-sim-container-orchestration.md)
- [`archive/008-v1-lsp-container-bridge.md`](archive/008-v1-lsp-container-bridge.md)
- [`archive/009-lsp-reconnect-and-bridge-serialization.md`](archive/009-lsp-reconnect-and-bridge-serialization.md)
- [`archive/010-gradle-project-cache-isolation.md`](archive/010-gradle-project-cache-isolation.md)
