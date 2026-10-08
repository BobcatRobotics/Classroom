---
sidebar_position: 4
title: Install CodeRunner Desktop
---

# Install CodeRunner Desktop

Follow these steps to install CodeRunner on a supported computer.

## Supported computers

- macOS on Apple silicon (Arm64)
- Windows on x64

## 1. Install Docker Desktop

CodeRunner uses Docker Desktop to run the local robot programming environment.
You do not need to create or sign in to a Docker account.

### macOS on Apple silicon

1. Download [Docker Desktop for Mac with Apple silicon](https://desktop.docker.com/mac/main/arm64/Docker.dmg).
2. Open the downloaded `Docker.dmg` file.
3. Drag Docker into the **Applications** folder.
4. Open Docker from **Applications**.
5. Accept Docker's terms and wait for Docker Desktop to finish starting.

### Windows x64

1. Download [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/).
2. Run the downloaded installer and follow its instructions. Use the recommended WSL 2 backend if prompted.
3. Open Docker Desktop.
4. Accept Docker's terms and wait for Docker Desktop to finish starting.

You can skip Docker Hub sign-in. Leave Docker Desktop running while using CodeRunner.

## 2. Install CodeRunner

Open the [CodeRunner v2027.0.8 release](https://github.com/BobcatRobotics/Classroom/releases/tag/v2027.0.8) and download the installer for your computer:

- **Mac with Apple silicon:** `CodeRunner-2027.0.8-arm64.dmg`
- **Windows x64:** download the Windows x64 installer listed on the release page.

### Install on macOS

1. Open the downloaded `.dmg` file.
2. Drag CodeRunner into the **Applications** folder.
3. IMPORTANT: Open **Terminal** from Applications → Utilities and run:
   ```bash
   sudo xattr -dr com.apple.quarantine "/Applications/CodeRunner.app"
3. Open CodeRunner from **Applications**.

### Install on Windows

1. Run the downloaded CodeRunner installer.
2. Follow the installation prompts.
3. Open CodeRunner from the Start menu.

## 3. Start CodeRunner

1. Make sure Docker Desktop is open and running.
2. Open CodeRunner.
3. Sign in with your GitHub account when prompted.
4. Wait while CodeRunner prepares the programming environment. The first setup downloads a large workspace image and may take several minutes.
5. When setup finishes, start working in CodeRunner.

Keep Docker Desktop running while CodeRunner is open.