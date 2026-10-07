import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { delimiter, dirname, join, win32 } from "node:path";

export type DockerCommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export const LOCAL_CODE_IMAGE =
	"docker.io/bobcatrobotics/coderunner-workspace@sha256:1e855cc6435445c14514541b1ce927bf51cc61a4f93fcf989853b7185fb64a25";

export type LocalHost = {
	platform: string;
	arch: string;
};

export type LocalDockerRunner = (
	args: string[],
	onProgress?: (line: string) => void,
) => Promise<DockerCommandResult>;

export type LocalSetupOptions = {
	docker: LocalDockerRunner;
	dataDir: string;
	host?: LocalHost;
	onProgress?: (message: string) => void;
};

export type LocalDockerInfo = {
	clientVersion: string;
	serverVersion: string;
	serverPlatform: string;
	operatingSystem: string;
};

export function findLocalDockerExecutable(
	platform: string,
	home: string,
	pathValue = "",
	exists: (path: string) => boolean = existsSync,
): string {
	if (platform !== "darwin") return "docker";

	const directories = pathValue.split(delimiter).filter(Boolean);
	directories.push(
		"/Applications/Docker.app/Contents/Resources/bin",
		join(home, "Applications", "Docker.app", "Contents", "Resources", "bin"),
		"/usr/local/bin",
		"/opt/homebrew/bin",
		join(home, ".docker", "bin"),
	);

	for (const directory of new Set(directories)) {
		const executable = join(directory, "docker");
		if (exists(executable)) return executable;
	}
	return "docker";
}

export function includeDockerDirectoryInPath(
	dockerPath: string,
	pathValue = "",
): string {
	const dockerDirectory = dirname(dockerPath);
	if (dockerDirectory === ".") return pathValue;

	const pathEntries = pathValue.split(delimiter).filter(Boolean);
	if (pathEntries.includes(dockerDirectory)) return pathValue;
	return [dockerDirectory, ...pathEntries].join(delimiter);
}

export function localDataDirectory(
	platform: string,
	home: string,
	localAppData = "",
): string {
	if (platform === "win32") {
		return win32.join(
			localAppData || win32.join(home, "AppData", "Local"),
			"CodeRunner",
		);
	}
	if (platform === "darwin") {
		return join(home, "Library", "Application Support", "CodeRunner");
	}
	throw new Error(
		"Local CodeRunner currently supports macOS and Windows only.",
	);
}

export function assertSupportedLocalHost(host: LocalHost): void {
	const supported =
		(host.platform === "darwin" &&
			(host.arch === "arm64" || host.arch === "x64")) ||
		(host.platform === "win32" && host.arch === "x64");
	if (!supported) {
		throw new Error(
			`Unsupported host ${host.platform}/${host.arch}. Supported hosts are macOS (Apple silicon or Intel) and Windows (x64).`,
		);
	}
}

export async function findLocalControlPort(
	preferredPort: number,
	portAvailable: (port: number) => Promise<boolean>,
	searchSize = 100,
): Promise<number> {
	if (
		!Number.isInteger(preferredPort) ||
		preferredPort < 1 ||
		preferredPort > 65535
	) {
		throw new Error("PORT must be an integer from 1 through 65535.");
	}
	const lastPort = Math.min(65535, preferredPort + searchSize - 1);
	for (let port = preferredPort; port <= lastPort; port += 1) {
		if (await portAvailable(port)) return port;
	}
	throw new Error(
		`No free local CodeRunner port is available in ${preferredPort}-${lastPort}. Close the conflicting application and retry.`,
	);
}

function dockerFailure(result: DockerCommandResult, args: string[]): Error {
	const details = result.stderr.trim() || result.stdout.trim();
	if (/permission denied|access is denied|not authorized/i.test(details)) {
		return new Error(
			"Docker is installed but CodeRunner cannot access it. Start Docker Desktop and approve its requested permissions, then retry. Do not change system permissions manually.",
		);
	}
	if (
		/cannot connect|daemon is not running|is the docker daemon running/i.test(
			details,
		)
	) {
		return new Error("Please start Docker and restart CodeRunner.");
	}
	if (args[0] === "pull") {
		return new Error(
			`Unable to download image, try again.${details ? `\nDocker pull details: ${details}` : ""}`,
		);
	}
	if (/no space left|insufficient space|not enough disk/i.test(details)) {
		return new Error(
			"Docker Desktop does not have enough disk space for the workspace image. Free disk space in Docker Desktop, then retry.",
		);
	}
	return new Error(
		`Docker ${args[0] ?? "command"} failed${details ? `: ${details}` : ` (exit ${result.exitCode})`}`,
	);
}

export async function inspectLocalDocker(
	docker: LocalDockerRunner,
): Promise<LocalDockerInfo> {
	let client: DockerCommandResult;
	try {
		client = await docker(["version", "--format", "{{.Client.Version}}"]);
	} catch {
		throw new Error(
			"Docker Desktop was not found. Install Docker Desktop, then restart CodeRunner.",
		);
	}
	if (client.exitCode !== 0) {
		throw dockerFailure(client, ["version"]);
	}

	let server: DockerCommandResult;
	try {
		server = await docker([
			"info",
			"--format",
			"{{.ServerVersion}}|{{.OSType}}/{{.Architecture}}|{{.OperatingSystem}}",
		]);
	} catch {
		throw new Error("Please start Docker and restart CodeRunner.");
	}
	if (server.exitCode !== 0) {
		throw dockerFailure(server, ["info"]);
	}

	const [serverVersion, serverPlatform, operatingSystem] = server.stdout
		.trim()
		.split("|");
	if (!serverVersion || !serverPlatform?.startsWith("linux/")) {
		throw new Error(
			"Docker Desktop is running, but its Linux container engine is unavailable. Switch Docker Desktop to Linux containers and retry.",
		);
	}
	if (!operatingSystem?.toLowerCase().includes("docker desktop")) {
		throw new Error(
			"CodeRunner requires Docker Desktop. Start its Linux container engine and retry.",
		);
	}

	return {
		clientVersion: client.stdout.trim(),
		serverVersion,
		serverPlatform,
		operatingSystem,
	};
}

export async function setupLocalRuntime(
	options: LocalSetupOptions,
): Promise<void> {
	const host = options.host ?? {
		platform: process.platform,
		arch: process.arch,
	};
	const progress = options.onProgress ?? (() => {});
	assertSupportedLocalHost(host);
	progress("Checking Docker Desktop...");
	await inspectLocalDocker(options.docker);

	progress("Preparing persistent local workspace storage...");
	await mkdir(options.dataDir, { recursive: true, mode: 0o700 });

	progress("Checking the pinned CodeRunner workspace image...");
	let image = await options.docker(["image", "inspect", LOCAL_CODE_IMAGE]);
	if (image.exitCode !== 0) {
		progress("Downloading the pinned workspace image...");
		const layers = new Map<string, string>();
		image = await options.docker(["pull", LOCAL_CODE_IMAGE], (line) => {
			const match = /^([a-f\d]{12,64}):\s*(.+)$/iu.exec(
				line
					.replace(
						new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu"),
						"",
					)
					.trim(),
			);
			if (!match) {
				progress("Downloading the pinned workspace image...");
				return;
			}
			const layerId = match[1] ?? "";
			const status = match[2]?.trim() ?? "";
			if (!layerId || !status) return;
			layers.set(layerId, status);
			const completed = [...layers.values()].filter((status) =>
				/^(pull complete|already exists)$/iu.test(status),
			).length;
			const active = [...layers.values()].filter((status) =>
				/^(downloading|extracting|verifying checksum|download complete)/iu.test(
					status,
				),
			).length;
			progress(
				`Downloading workspace image: ${completed} layer${completed === 1 ? "" : "s"} complete, ${active} downloading or extracting (${layers.size} layers reported)`,
			);
		});
		if (image.exitCode !== 0) {
			throw dockerFailure(image, ["pull"]);
		}
		image = await options.docker(["image", "inspect", LOCAL_CODE_IMAGE]);
		if (image.exitCode !== 0) {
			throw new Error(
				"Docker finished the image download but the pinned image is still unavailable. Check Docker Desktop storage and retry.",
			);
		}
	}
	progress("Local runtime setup is ready.");
}

export async function localDiagnostics(
	docker: LocalDockerRunner,
	host: LocalHost = { platform: process.platform, arch: process.arch },
	version = "development",
): Promise<string> {
	const lines = [
		"CodeRunner local runtime diagnostics",
		`CodeRunner version: ${version}`,
		`Host: ${host.platform}/${host.arch}`,
		`Workspace image: ${LOCAL_CODE_IMAGE}`,
	];
	try {
		const info = await inspectLocalDocker(docker);
		lines.push(`Docker client: ${info.clientVersion}`);
		lines.push(`Docker engine: ${info.serverVersion} (${info.serverPlatform})`);
		lines.push(`Docker Desktop: ${info.operatingSystem}`);
		const image = await docker(["image", "inspect", LOCAL_CODE_IMAGE]);
		lines.push(`Pinned image present: ${image.exitCode === 0 ? "yes" : "no"}`);
	} catch (error) {
		lines.push(
			`Docker status: ${error instanceof Error ? error.message : "unavailable"}`,
		);
	}
	lines.push(
		"Project files, local paths, credentials, and environment values are not included.",
	);
	return lines.join("\n");
}
