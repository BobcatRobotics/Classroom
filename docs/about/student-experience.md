---
sidebar_position: 2
title: The Student Experience
---

# The Student Experience

This page describes what a student sees and does from the moment they open
CodeRunner to the moment they watch their robot simulation run. No software
installation is required on the student's machine.

## Signing in

Students authenticate through OAuth — either **GitHub** or **Google**,
depending on which providers the operator has configured. The sign-in page
presents the available options. After the OAuth callback, CodeRunner checks
whether the student's email is on the team's allowlist; if it is not, sign-in
is rejected with a message telling them to ask their coach to add them.

On first successful sign-in, CodeRunner creates the student's workspace record
and their file directories on the server. The student is then redirected to
their workspace.

## The workspace shell

After signing in the student lands in the workspace shell — a full-page web
application built around three panes:

- **Editor** (left) — openvscode-server embedded in an iframe. This is a
  real VS Code environment in the browser, complete with the
  [Red Hat Java](https://marketplace.visualstudio.com/items?itemName=redhat.java)
  language server, the WPILib extension, IntelliSense, and a terminal.
- **AdvantageScope Lite** (right) — a telemetry viewer embedded as a
  second iframe, showing field positions, signals, and plots published by the
  running robot program over NetworkTables.
- **Driver Station** (bottom) — run controls, mode selection, console output,
  and gamepad/keyboard input. See [below](#the-driver-station).

The panes are resizable. On narrow screens the AdvantageScope pane is hidden
automatically to leave room for the editor.

The topbar shows the CodeRunner logo, a **Switch project** button, and the
student's account menu.

## Loading a project

A new workspace starts empty — there is no code in the editor until the student
picks a project. Clicking **Switch project** opens a dialog that offers two
ways to fill the workspace:

**Lesson modules** are structured exercises provided by the operator. Each
module has a title, a short description, and a kind badge (Robot or Console).
Clicking **Load** on a module copies the starter files into the workspace and
opens them in the editor. The current module is shown with a **Reset** button
that reloads the original files from the catalog, discarding any changes.

**Import from GitHub** lets a student paste a public `github.com` HTTPS URL.
The control plane clones the repository into the workspace, preserving the
`.git` history. This is the normal path for build-season team work — the
student can push commits back to GitHub from the editor's integrated terminal
once they have authenticated with `gh auth login`.

Either action replaces whatever was in the workspace, so the dialog shows a
confirmation step before proceeding.

## The Driver Station

For **robot lessons** (kind: Robot) and team imports, the full Driver Station
chrome is shown. For **console lessons** (kind: Console), the Driver Station
and AdvantageScope panes are hidden and the editor fills the window; a hint bar
at the bottom explains that the lesson is run from the editor's Run button
instead.

When the sim panes are visible, the Driver Station panel at the bottom of the
screen has three tabs:

- **Console** — live output from the Gradle build and the running robot
  program.
- **Workbench** — the run controls, mode selector, and status indicators.
- **Controls** — input device selection and a live controller visualizer.

### Starting and stopping a run

The **Workbench** tab has a **Run** button. Clicking it tells the control plane
to compile and simulate the project. Build output streams into the Console in
real time. If the build fails, the error is shown and the run stops. On success,
the simulator starts and the Driver Station becomes active.

The **Stop** and **Restart** buttons appear while a run is in progress.

### Robot modes

Three mode buttons appear in the Workbench: **Teleop**, **Auto**, and **Test**.
Selecting a mode while the robot is enabled immediately changes the operating
mode. The robot must be **Enabled** (via the Enable/Disable row at the bottom
of the Workbench) before it responds to mode changes; disabling it sets outputs
to zero.

### Controller and keyboard input

The **Controls** tab lets the student select how joystick data is sent to the
simulated robot. Two modes are available:

- **Controller** — any gamepad connected to the browser (via the
  [Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API))
  appears in a dropdown. Selecting one sends its live axis and button state to
  the simulator as joystick port 0.
- **Keyboard (Xbox Mapping)** — the keyboard is mapped to a standard Xbox
  controller layout. A "View mapping" button shows the full key-to-axis/button
  table. Keyboard capture is active only while the Driver Station section has
  focus; a status badge shows **KEYS ACTIVE** or **FOCUS LOST** accordingly.

A live SVG visualizer in the Controls tab mirrors the current controller state
in real time, regardless of which input mode is selected.

### Auto chooser

A fourth **Auto** tab appears when the running robot publishes a
`SendableChooser` (autonomous routine selector) via NetworkTables. The student
can pick among the available routines while the robot is running.

## Live telemetry

While the robot is running, AdvantageScope Lite (right pane) connects to the
robot's NetworkTables server. Because container ports are never exposed to the
browser directly, this connection is proxied through the control plane — see
[Architecture](./architecture.md) for the full data path. The student sees
field positions, signal graphs, and any other NetworkTables data their robot
code publishes, updating live.
