# CodeRunner

A self-hosted, browser-based IDE for learning FRC robot programming. Students get a hosted VS Code editor with full Java and WPILib extension support, isolated per-student Docker workspaces, one-click robot simulation with a Driver Station UI, and live AdvantageScope telemetry — all in the browser with no software to install. Lesson modules guide learners from first steps through custom robot code; GitHub team import lets existing teams bring their own projects.

## Quick Start

Try CodeRunner locally in demo mode — no OAuth, no allowlist, no configuration required:

```bash
git clone https://github.com/mathewdunne/CodeRunner coderunner
cd coderunner
git submodule update --init --recursive
bun install
bun run build
bun run start -- --demo
```

Open [http://localhost:4000](http://localhost:4000). You land directly in the IDE as a single seeded admin user.

**Prerequisites:** Bun 1.3.13+, Docker (running), Git with submodule support.

> **Warning:** Demo mode bypasses authentication entirely. Every visitor shares the same admin user and workspace. Do not expose a demo instance to the public internet. See [docs/quick-start.md](docs/quick-start.md) for full details and next steps.

## Documentation

Documentation lives in [`docs/`](docs/) and is built with [Docusaurus](https://docusaurus.io/) from [`website/`](website/). To browse locally:

```bash
cd website && bun install && bun run start
```

Or from the repo root:

```bash
bun run docs:dev
```

Main sections:

- [Quick Start](docs/quick-start.md) — demo mode walkthrough
- [Architecture](docs/about/architecture.md) — how the system is put together
- [Lessons & Modules](docs/lessons/overview.md) — lesson catalog, module authoring, GitHub import
- [Deploying](docs/deploying/overview.md) — running a real multi-user instance
- [Day-to-Day Operations](docs/operating/day-to-day.md) — managing a live deployment
- [Development Setup](docs/development/dev-servers.md) — running the app locally for development
- [Configuration Reference](docs/reference/configuration.md) — all environment variables

## Development

Start the control plane and web shell in parallel:

```bash
bun run dev:control   # Bun control plane on :4000 with --watch
bun run dev:web       # Vite web shell on :5173 with HMR
```

Run the full verification suite before submitting changes:

```bash
bun run verify        # typecheck + Bun tests + Vitest + Playwright
```

See [docs/development/dev-servers.md](docs/development/dev-servers.md) for the full development workflow.
