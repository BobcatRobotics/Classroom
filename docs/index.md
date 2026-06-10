---
slug: /
sidebar_position: 1
title: CodeRunner
---

# CodeRunner

CodeRunner is a self-hosted, browser-based IDE for teaching FRC robot programming. Students open a web page, log in, write Java in a real VS Code editor, click **Run**, and watch their robot simulate in real time. There is nothing to install on a student's machine and no per-laptop setup to maintain — everything runs on a machine you control and is delivered through the browser.

## What students get

- **A real VS Code editor in the browser.** Each student works in openvscode-server with the Java and WPILib extensions already installed, so they get auto-import, code completion, Ctrl-click into library classes, and inline diagnostics — the same tooling a mentor would use locally.
- **An isolated workspace per student.** Every student gets their own Docker container, so one person's broken build or runaway process never affects anyone else.
- **One-click simulation with a built-in Driver Station.** Clicking Run builds the project and starts a WPILib simulation. A Driver Station UI is built into the page for enabling the robot, switching modes, and driving with a gamepad.
- **Live telemetry.** Robot data streams into an embedded AdvantageScope view, so students can see what their code is actually doing as it runs.

## Lessons and team projects

CodeRunner ships with lesson modules that take beginners from plain Java all the way up to a complete WPILib robot, one step at a time. Students choose a lesson from the editor and their workspace fills in with the starting code. When a team is ready to work on its own robot, they can instead import a public GitHub robot project and keep working against their real codebase.

## Self-hosted and modest to run

CodeRunner is designed to run on hardware you already have — a spare classroom machine during the season, or a small cloud VM when you want students to reach it from home. You decide who can log in, and student data lives on your own disk.

## Next steps

- [Quick Start](./quick-start.md) — get a demo instance running locally in a few commands.
- [About CodeRunner](./about/architecture.md) — how the pieces fit together and what the [student experience](./about/student-experience.md) looks like.
- [Deploying](./deploying/overview.md) — set up a real, multi-user instance with login.
- [Lessons](./lessons/overview.md) — what the bundled lessons cover and how to author your own.
