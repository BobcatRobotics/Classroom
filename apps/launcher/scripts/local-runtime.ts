import { homedir } from "node:os";
import {
	launcherIdentitySchema,
	localUserIdentitySchema,
} from "@frc-coderunner/contracts";
import { configureCentralCatalog } from "../runtime/central-catalog";
import {
	type DockerCommandResult,
	findLocalControlPort,
	findLocalDockerExecutable,
	includeDockerDirectoryInPath,
	localDataDirectory,
	localDiagnostics,
	setupLocalRuntime,
} from "../runtime/local-setup";
import { portIsFree } from "../runtime/ports";

const command = Bun.argv[2] ?? "setup";
const packagedDataDir =
	Bun.env.CODERUNNER_DESKTOP === "1" ? Bun.env.FRC_DATA_DIR?.trim() : undefined;
const dataDir =
	packagedDataDir ||
	localDataDirectory(process.platform, homedir(), Bun.env.LOCALAPPDATA);
const dockerPath =
	Bun.env.FRC_DOCKER_PATH?.trim() ||
	findLocalDockerExecutable(process.platform, homedir(), Bun.env.PATH);
const dockerSearchPath = includeDockerDirectoryInPath(dockerPath, Bun.env.PATH);
const dockerEnvironment = { ...process.env };
delete dockerEnvironment.FRC_LAUNCH_GRANT;
delete dockerEnvironment.CODERUNNER_CENTRAL_SYNC_TICKET;
if (dockerSearchPath) dockerEnvironment.PATH = dockerSearchPath;
Bun.env.FRC_DOCKER_PATH = dockerPath;

async function runDocker(
	args: string[],
	onProgress?: (line: string) => void,
): Promise<DockerCommandResult> {
	const subprocess = Bun.spawn([dockerPath, ...args], {
		env: dockerEnvironment,
		stdout: "pipe",
		stderr: "pipe",
	});
	const read = async (stream: ReadableStream<Uint8Array>, emit: boolean) => {
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let output = "";
		let pending = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = decoder.decode(value, { stream: true });
			output += chunk;
			if (emit && onProgress) {
				pending += chunk;
				const lines = pending.split(/[\r\n]+/u);
				pending = lines.pop() ?? "";
				for (const line of lines) {
					if (line.trim()) onProgress(line);
				}
			}
		}
		pending += decoder.decode();
		if (emit && pending.trim()) onProgress?.(pending);
		return output;
	};
	const [stdout, stderr, exitCode] = await Promise.all([
		read(subprocess.stdout, args[0] === "pull"),
		read(subprocess.stderr, args[0] === "pull"),
		subprocess.exited,
	]);
	return { stdout, stderr, exitCode };
}

function printProgress(message: string): void {
	console.log(message);
}

async function setup(): Promise<void> {
	await setupLocalRuntime({
		docker: runDocker,
		dataDir,
		onProgress: printProgress,
	});
}

async function authorizePackagedStart(): Promise<void> {
	if (Bun.env.CODERUNNER_DESKTOP !== "1") return;
	if (
		["1", "true", "yes", "on"].includes(
			(Bun.env.CODERUNNER_DEMO_MODE ?? "").trim().toLowerCase(),
		)
	) {
		delete Bun.env.FRC_LAUNCH_GRANT;
		return;
	}
	const runtimeTicket = Bun.env.FRC_LAUNCH_GRANT?.trim();
	const centralUrl = Bun.env.CODERUNNER_CENTRAL_URL?.trim();
	if (!runtimeTicket || !centralUrl) {
		throw new Error("Sign in to CodeRunner before starting the local runtime.");
	}
	let validateUrl: URL;
	try {
		validateUrl = new URL("/api/launcher/validate-launch", centralUrl);
	} catch {
		throw new Error("CodeRunner's central server URL is invalid.");
	}
	const isLoopbackHttp =
		validateUrl.protocol === "http:" &&
		["localhost", "127.0.0.1"].includes(validateUrl.hostname);
	if (validateUrl.protocol !== "https:" && !isLoopbackHttp) {
		throw new Error("CodeRunner sign-in requires a trusted HTTPS server URL.");
	}
	const response = await fetch(validateUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ runtimeTicket }),
	});
	if (!response.ok) {
		throw new Error(
			"CodeRunner launch authorization expired. Sign in and retry.",
		);
	}
	const result = (await response.json()) as { identity?: unknown };
	const centralIdentity = launcherIdentitySchema.parse(result.identity);
	await configureCentralCatalog(Bun.env);
	const localIdentity = localUserIdentitySchema.parse({
		displayName: centralIdentity.displayName,
		email: centralIdentity.email,
		avatarUrl: centralIdentity.avatarUrl,
		role: centralIdentity.role,
	});
	Bun.env.CODERUNNER_LOCAL_IDENTITY = JSON.stringify(localIdentity);
	Bun.env.CODERUNNER_CENTRAL_SYNC_TICKET = runtimeTicket;
	delete Bun.env.FRC_LAUNCH_GRANT;
}

async function start(): Promise<void> {
	await authorizePackagedStart();
	await setup();
	const preferredPort = Number(Bun.env.PORT ?? 4000);
	const port = await findLocalControlPort(preferredPort, portIsFree);
	if (port !== preferredPort) {
		console.log(`Port ${preferredPort} is busy; using ${port} instead.`);
	}
	Bun.env.FRC_DATA_DIR = dataDir;
	Bun.env.FRC_BIND_HOST = "127.0.0.1";
	Bun.env.FRC_LOCAL_CODE_IMAGE = "";
	Bun.env.PORT = String(port);
	const serverStarted = import("../runtime/local-main");
	const baseUrl = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + 10 * 60 * 1000;
	let ready = false;

	while (!ready && Date.now() < deadline) {
		try {
			const response = await fetch(`${baseUrl}/u/demo/api/containers/status`, {
				signal: AbortSignal.timeout(3000),
			});
			if (response.ok) {
				const status = (await response.json()) as {
					code?: { ready?: boolean; state?: string; error?: string | null };
				};
				if (status.code?.ready) ready = true;
				if (status.code?.state === "error" && status.code.error) {
					console.error(status.code.error);
				}
			}
		} catch {
			// The local server or workspace may still be starting.
		}
		if (!ready) await new Promise((resolve) => setTimeout(resolve, 1500));
	}

	if (ready) {
		console.log(`Local CodeRunner is ready: ${baseUrl}/u/demo/`);
	} else {
		console.error(
			`Workspace startup timed out. The local service is still running; inspect its output or run bun run --cwd apps/launcher local:diagnostics.`,
		);
	}
	await serverStarted;
}

try {
	switch (command) {
		case "setup":
		case "repair":
			await setup();
			break;
		case "start":
			await start();
			break;
		case "diagnostics":
			console.log(
				await localDiagnostics(
					runDocker,
					undefined,
					Bun.env.CODERUNNER_VERSION ?? "development",
				),
			);
			break;
		default:
			throw new Error(
				"Usage: bun run --cwd apps/launcher local:setup | local:repair | local:start | local:diagnostics",
			);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
