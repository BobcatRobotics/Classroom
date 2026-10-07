import { homedir } from "node:os";
import type { DockerCommandResult } from "../apps/control/src/containers";
import { portIsFree } from "../apps/control/src/containers/ports";
import {
	findLocalControlPort,
	localDataDirectory,
	localDiagnostics,
	setupLocalRuntime,
} from "../apps/control/src/local-setup";

const command = Bun.argv[2] ?? "setup";
const packagedDataDir =
	Bun.env.CODERUNNER_DESKTOP === "1" ? Bun.env.FRC_DATA_DIR?.trim() : undefined;
const dataDir =
	packagedDataDir ||
	localDataDirectory(process.platform, homedir(), Bun.env.LOCALAPPDATA);

async function runDocker(
	args: string[],
	onProgress?: (line: string) => void,
): Promise<DockerCommandResult> {
	const subprocess = Bun.spawn(["docker", ...args], {
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
				const lines = pending.split(/\r?\n/u);
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

async function start(): Promise<void> {
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
	const serverStarted = import("../apps/control/src/local-main");
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
			`Workspace startup timed out. The local service is still running; inspect its output or run bun run local:diagnostics.`,
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
			console.log(await localDiagnostics(runDocker));
			break;
		default:
			throw new Error(
				"Usage: bun run local:setup | local:start | local:repair | local:diagnostics",
			);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
