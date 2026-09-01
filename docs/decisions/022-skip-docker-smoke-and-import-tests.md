# Decision 022: Skip Docker smoke tier and import/backup-restore E2E tests

## Status
Superseded in part by decision 038; import/backup scope amended after decision 029

## Context

The testing plan (TESTING-PLAN.md) originally described two categories of tests that we decided not to implement as written:

1. **Docker smoke tier (T-D1 through T-D7)**: Tests that exercise the real `coderunner-workspace` container image — building, running Gradle, JNI loading, multi-workspace Gradle lock isolation, headless GUI removal, etc.

2. **Import and backup/restore E2E tests**: Tests covering the GitHub project import flow, size limits, rate limits, post-import permissions, and backup/restore functionality.

## Decision

### Broad Docker smoke tier — not implemented

The proposed broad Docker smoke tier requires:
- A Docker daemon available in the test environment
- The `coderunner-workspace` image pre-built (`bun run docker:build:workspace`)
- Multi-minute timeouts per test (180s default, up to 420s for extension cold start)
- Fixture projects committed for specific edge cases (vendor-JNI, headless-incompatible, broken-build)

The mocked E2E tier and unit tests already cover the logic paths (run lifecycle, timeout handling, state recovery, build failures). The Docker tier would only prove the real runtime boundary works, which is validated manually during development and deployment.

The cost/benefit ratio doesn't justify that broad infrastructure investment
for this project's scale and team size. Decision 038 adds one narrower
exception: a targeted real VSCodium/JDT/Java/WPILib smoke because a Java
extension compatibility regression cannot be detected by manifests or mocked
upstreams.

### Import and backup/restore tests — updated after lessons rework

The lessons/project-switch rework landed in decision 029. The old per-import
backup/restore flow no longer exists, so that deferred E2E scope is obsolete.
Import and catalog-load coverage now lives in Bun control-plane tests, shared
contract/property tests, Vitest hook/component tests, and the mocked E2E
URL-validation spec. The broad Docker smoke tier remains intentionally skipped;
decision 038's targeted Java workspace smoke is the only exception.

## Consequences

- General Docker-specific edge cases (GLIBCXX versions and Gradle lock contention) remain manually tested; the Java tooling and supported simulation path now have the targeted decision-038 smoke
- Import flow regressions are covered in the mocked/control-plane tiers, not by a Docker smoke tier
- The mocked E2E tier remains the primary integration test surface
