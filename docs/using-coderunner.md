---
sidebar_position: 2
title: Using CodeRunner
---

# Using CodeRunner

## Get started

1. Sign in.
2. Click **Switch project**, then load a lesson or import a public GitHub project.
3. For a lesson, open its README and follow the instructions. For an imported
   project, open the files you want to work on.

:::warning[Switching projects discards your current workspace]

Switching or resetting replaces your current files. For an imported project,
commit and push any work you want to keep.

:::

## Robot lessons and imported projects

:::important[Start the simulation from CodeRunner]

The WPILib extension can start a simulation, but you should not use it here.
Click **Start** in the Driver Station at the bottom of the page so CodeRunner
can use its supported headless simulation setup and connect the controls and
telemetry.

:::

![The Driver Station before a run, with Start available and Enable waiting for robot code and communications](/img/screenshots/using-coderunner-start.png)

1. Click **Start** in the Driver Station.
2. Wait for **Comms** and **Robot Code** to turn green.

![The Driver Station ready to enable, with Comms and Robot Code green](/img/screenshots/using-coderunner-ready.png)

3. Select **Teleop**, **Auto**, or **Test**, then click **Enable**.
4. Click **Stop** when you are finished, or **Restart** to stop the code and re-run with any changes you've made.

Build output and robot output appear in the **Console** tab. Telemetry appears in
AdvantageScope.

## Console lessons

`Console` type lessons are pure Java exercises, not robot projects. Because they
do not run a robot simulation, the Driver Station and AdvantageScope are hidden,
and the VS Code editor expands to fill the full screen. Use the editor's **Run**
button to run them.

## Explore more

While a robot simulation is running, explore the Driver Station's **Auto** and
**Controls** tabs. **Auto** appears when the robot code publishes an autonomous
chooser; **Controls** lets you select a gamepad or keyboard input to control the
simulation.
