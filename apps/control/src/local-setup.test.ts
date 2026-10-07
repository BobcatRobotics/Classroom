import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DockerCommandResult } from "./containers";
import {
	assertSupportedLocalHost,
	findLocalControlPort,
	LOCAL_CODE_IMAGE,
	type LocalDockerRunner,
	localDataDirectory,
	localDiagnostics,
	setupLocalRuntime,
} from "./local-setup";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

function result(stdout = "", stderr = "", exitCode = 0): DockerCommandResult {
	return { stdout, stderr, exitCode };
}

describe("local runtime setup", () => {
	test("selects per-user data roots on macOS and Windows", () => {
		expect(localDataDirectory("darwin", "/Users/student")).toBe(
			"/Users/student/Library/Application Support/CodeRunner",
		);
		expect(
			localDataDirectory("win32", "C:\\Users\\student", "D:\\LocalAppData"),
		).toBe("D:\\LocalAppData\\CodeRunner");
	});

	test("rejects unsupported host architectures with supported options", () => {
		expect(() =>
			assertSupportedLocalHost({ platform: "darwin", arch: "x64" }),
		).not.toThrow();
		expect(() =>
			assertSupportedLocalHost({ platform: "win32", arch: "x64" }),
		).not.toThrow();
		expect(() =>
			assertSupportedLocalHost({ platform: "linux", arch: "x64" }),
		).toThrow("macOS (Apple silicon or Intel) and Windows (x64)");
		expect(() =>
			assertSupportedLocalHost({ platform: "win32", arch: "arm64" }),
		).toThrow("Windows (x64)");
	});

	test("moves to the next free local control port", async () => {
		const checkedPorts: number[] = [];
		const port = await findLocalControlPort(4000, async (candidate) => {
			checkedPorts.push(candidate);
			return candidate === 4002;
		});
		expect(port).toBe(4002);
		expect(checkedPorts).toEqual([4000, 4001, 4002]);
	});

	test("explains when no local control port is available", async () => {
		await expect(
			findLocalControlPort(4000, async () => false, 2),
		).rejects.toThrow(
			"No free local CodeRunner port is available in 4000-4001",
		);
	});

	test("pulls the immutable image once and is idempotent", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "coderunner-local-setup-"));
		temporaryDirectories.push(dataDir);
		let imagePresent = false;
		const calls: string[][] = [];
		const docker: LocalDockerRunner = async (args) => {
			calls.push(args);
			if (args[0] === "version") return result("27.0.3\n");
			if (args[0] === "info") {
				return result("27.0.3|linux/arm64|Docker Desktop\n");
			}
			if (args[0] === "image" && args[1] === "inspect") {
				return imagePresent ? result("image-id\n") : result("", "not found", 1);
			}
			if (args[0] === "pull") {
				imagePresent = true;
				return result("pulled\n");
			}
			throw new Error(`Unexpected Docker command: ${args.join(" ")}`);
		};

		await setupLocalRuntime({
			docker,
			dataDir,
			host: { platform: "darwin", arch: "arm64" },
		});
		await setupLocalRuntime({
			docker,
			dataDir,
			host: { platform: "darwin", arch: "arm64" },
		});

		expect(calls.filter(([command]) => command === "pull")).toHaveLength(1);
		expect(calls.some((args) => args.includes(LOCAL_CODE_IMAGE))).toBe(true);
		expect(
			calls.some((args) => args[0] === "pull" && args[1] === LOCAL_CODE_IMAGE),
		).toBe(true);
	});

	test("allows a failed image download to be retried without changing projects", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "coderunner-local-retry-"));
		temporaryDirectories.push(dataDir);
		const projectDir = join(dataDir, "project");
		await mkdir(projectDir);
		const markerPath = join(projectDir, "student-work.txt");
		await writeFile(markerPath, "keep this project\n");
		let imagePresent = false;
		let failPull = true;
		const docker: LocalDockerRunner = async (args) => {
			if (args[0] === "version") return result("27.0.3\n");
			if (args[0] === "info") {
				return result("27.0.3|linux/arm64|Docker Desktop\n");
			}
			if (args[0] === "image" && args[1] === "inspect") {
				return imagePresent ? result("image-id\n") : result("", "not found", 1);
			}
			if (args[0] === "pull") {
				if (failPull) return result("", "unexpected EOF", 1);
				imagePresent = true;
				return result("pulled\n");
			}
			throw new Error(`Unexpected Docker command: ${args.join(" ")}`);
		};

		await expect(
			setupLocalRuntime({
				docker,
				dataDir,
				host: { platform: "darwin", arch: "arm64" },
			}),
		).rejects.toThrow("Check the internet connection and retry");
		expect(await readFile(markerPath, "utf8")).toBe("keep this project\n");

		failPull = false;
		await setupLocalRuntime({
			docker,
			dataDir,
			host: { platform: "darwin", arch: "arm64" },
		});
		expect(await readFile(markerPath, "utf8")).toBe("keep this project\n");
	});

	test("reports daemon and disk failures with a supported next step", async () => {
		const unavailableDocker: LocalDockerRunner = async (args) =>
			args[0] === "version"
				? result("27.0.3")
				: result("", "Cannot connect to the Docker daemon", 1);
		await expect(
			setupLocalRuntime({
				docker: unavailableDocker,
				dataDir: "/tmp/coderunner-unused",
				host: { platform: "darwin", arch: "arm64" },
			}),
		).rejects.toThrow("Open Docker Desktop");

		const noDiskDocker: LocalDockerRunner = async (args) => {
			if (args[0] === "version") return result("27.0.3");
			if (args[0] === "info") {
				return result("27.0.3|linux/arm64|Docker Desktop");
			}
			if (args[0] === "image") return result("", "not found", 1);
			return result("", "no space left on device", 1);
		};
		await expect(
			setupLocalRuntime({
				docker: noDiskDocker,
				dataDir: "/tmp/coderunner-unused",
				host: { platform: "darwin", arch: "arm64" },
			}),
		).rejects.toThrow("Free disk space in Docker Desktop");
	});

	test("rejects a non-Docker-Desktop engine", async () => {
		const otherEngine: LocalDockerRunner = async (args) =>
			args[0] === "version"
				? result("27.0.3")
				: result("27.0.3|linux/arm64|Rancher Desktop");
		await expect(
			setupLocalRuntime({
				docker: otherEngine,
				dataDir: "/tmp/coderunner-unused",
				host: { platform: "darwin", arch: "arm64" },
			}),
		).rejects.toThrow("CodeRunner requires Docker Desktop");
	});

	test("diagnostics omit local paths and environment values", async () => {
		const docker: LocalDockerRunner = async (args) => {
			if (args[0] === "version") return result("27.0.3");
			if (args[0] === "info") {
				return result("27.0.3|linux/arm64|Docker Desktop");
			}
			return result("image-id");
		};
		const report = await localDiagnostics(docker, {
			platform: "darwin",
			arch: "arm64",
		});
		expect(report).toContain("Docker engine: 27.0.3 (linux/arm64)");
		expect(report).toContain("Docker Desktop: Docker Desktop");
		expect(report).toContain("Project files, local paths, credentials");
		expect(report).not.toContain("/Users/");
		expect(report).not.toContain("TOKEN");
	});
});
