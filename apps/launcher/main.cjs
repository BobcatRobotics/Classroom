const {
	app,
	BrowserWindow,
	clipboard,
	dialog,
	Menu,
	shell,
} = require("electron");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { createHash, randomBytes } = require("node:crypto");
const { createServer } = require("node:http");
const { homedir } = require("node:os");
const { join } = require("node:path");

const appTitle = `CodeRunner v${app.getVersion()}`;
const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
	app.quit();
}

let mainWindow = null;
let runtimeProcess = null;
let quitting = false;
let runtimeUrl = null;
let activeLaunchTicket = null;
const recentOutput = [];

const runtimeDirectory = join(process.resourcesPath, "runtime");
const runtimeBundle = join(runtimeDirectory, "local-runtime.js");
// const defaultCentralUrl = "https://coderunner.bobcatrobotics.org";
const defaultCentralUrl = "http://localhost:4000"
const bunExecutable = join(
	runtimeDirectory,
	"bin",
	process.platform === "win32" ? "bun.exe" : "bun",
);

function dataDirectory() {
	if (process.platform === "win32") {
		return join(
			process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
			"CodeRunner",
		);
	}
	return join(homedir(), "Library", "Application Support", "CodeRunner");
}

function runtimeEnvironment() {
	const environment = {
		...process.env,
		CODERUNNER_DESKTOP: "1",
		FRC_DATA_DIR: dataDirectory(),
		FRC_BIND_HOST: "127.0.0.1",
		FRC_LOCAL_CODE_IMAGE: "",
		FRC_WEB_DIST_DIR: join(runtimeDirectory, "web"),
		FRC_ASCOPE_DIST_DIR: join(runtimeDirectory, "advantagescope"),
		FRC_PATHPLANNER_DIST_DIR: join(runtimeDirectory, "pathplanner"),
		CODERUNNER_CENTRAL_URL:
			process.env.CODERUNNER_CENTRAL_URL || defaultCentralUrl,
		LESSONS_CATALOG_DIR: join(runtimeDirectory, "catalog"),
		FRC_MIGRATIONS_DIR: join(runtimeDirectory, "migrations"),
		CODERUNNER_VERSION: app.getVersion(),
	};
	delete environment.FRC_LAUNCH_GRANT;
	return environment;
}

function setProgress(message) {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	mainWindow.webContents
		.executeJavaScript(
			`document.getElementById("status").textContent = ${JSON.stringify(message)}`,
		)
		.catch(() => {});
}

function getCentralOrigin() {
	const centralUrl = new URL(
		process.env.CODERUNNER_CENTRAL_URL || defaultCentralUrl,
	);
	const isLocalHttp =
		centralUrl.protocol === "http:" &&
		["localhost", "127.0.0.1"].includes(centralUrl.hostname);
	if (
		(centralUrl.protocol !== "https:" && !isLocalHttp) ||
		centralUrl.username ||
		centralUrl.password
	) {
		throw new Error("CodeRunner sign-in requires a trusted HTTPS server URL.");
	}
	return centralUrl.origin;
}

function startAuthorizationCallback(state) {
	let resolveCode;
	let rejectCode;
	const codePromise = new Promise((resolve, reject) => {
		resolveCode = resolve;
		rejectCode = reject;
	});
	const server = createServer((request, response) => {
		let callbackUrl;
		try {
			callbackUrl = new URL(request.url || "/", "http://127.0.0.1");
		} catch {
			response.writeHead(400).end("Invalid authorization response.");
			return;
		}
		const code = callbackUrl.searchParams.get("code") || "";
		if (
			request.method !== "GET" ||
			callbackUrl.pathname !== "/callback" ||
			callbackUrl.searchParams.get("state") !== state ||
			!/^[A-Za-z0-9_-]{43}$/u.test(code)
		) {
			response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
			response.end(
				"Authorization could not be completed. Return to CodeRunner and retry.",
			);
			return;
		}
		response.writeHead(200, {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
			"Content-Security-Policy":
				"default-src 'none'; style-src 'unsafe-inline'",
		});
		response.end(
			"<!doctype html><meta charset=utf-8><title>CodeRunner</title><p>CodeRunner is authorized. You can close this tab.</p>",
		);
		resolveCode(code);
	});
	server.on("error", rejectCode);
	return { server, codePromise };
}

async function authorizeLauncher() {
	const centralOrigin = getCentralOrigin();
	const codeVerifier = randomBytes(32).toString("base64url");
	const codeChallenge = createHash("sha256")
		.update(codeVerifier)
		.digest("base64url");
	const state = randomBytes(32).toString("base64url");
	const callback = startAuthorizationCallback(state);
	let timeout;

	try {
		await new Promise((resolve, reject) => {
			callback.server.once("error", reject);
			callback.server.listen(0, "127.0.0.1", resolve);
		});
		const address = callback.server.address();
		if (!address || typeof address === "string") {
			throw new Error("Could not start the local sign-in callback.");
		}
		const authorizeUrl = new URL("/launcher/authorize", centralOrigin);
		authorizeUrl.searchParams.set(
			"redirect_uri",
			`http://127.0.0.1:${address.port}/callback`,
		);
		authorizeUrl.searchParams.set("state", state);
		authorizeUrl.searchParams.set("code_challenge", codeChallenge);
		setProgress("Complete CodeRunner sign-in in your browser...");
		await shell.openExternal(authorizeUrl.toString());

		const code = await Promise.race([
			callback.codePromise,
			new Promise((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error("Sign-in timed out. Please try again.")),
					5 * 60 * 1000,
				);
			}),
		]);
		const response = await fetch(`${centralOrigin}/api/launcher/exchange`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code, codeVerifier }),
		});
		if (!response.ok) {
			throw new Error(
				response.status === 403
					? "This CodeRunner account is disabled. Contact your coach."
					: "CodeRunner could not verify sign-in. Please try again.",
			);
		}
		const result = await response.json();
		if (result?.ok !== true || typeof result.runtimeTicket !== "string") {
			throw new Error("CodeRunner returned an invalid launch authorization.");
		}
		return result.runtimeTicket;
	} finally {
		if (timeout) clearTimeout(timeout);
		callback.server.close();
	}
}

async function startAfterAuthorization() {
	while (!quitting) {
		try {
			const runtimeTicket = await authorizeLauncher();
			if (!quitting) {
				activeLaunchTicket = runtimeTicket;
				startRuntime();
			}
			return;
		} catch (error) {
			const result = await dialog.showMessageBox(mainWindow, {
				type: "warning",
				title: "CodeRunner sign-in required",
				message: "CodeRunner could not authorize this launch.",
				detail: error instanceof Error ? error.message : String(error),
				buttons: ["Try again", "Quit"],
				defaultId: 0,
				cancelId: 1,
			});
			if (result.response !== 0) {
				app.quit();
				return;
			}
		}
	}
}

function appendOutput(line) {
	recentOutput.push(line);
	if (recentOutput.length > 80) recentOutput.shift();
	setProgress(line);
}

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 820,
		minWidth: 900,
		minHeight: 620,
		show: false,
		backgroundColor: "#111318",
		title: appTitle,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	mainWindow.webContents.on("page-title-updated", (event) => {
		event.preventDefault();
		mainWindow?.setTitle(appTitle);
	});
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("http://127.0.0.1:")) return { action: "allow" };
		void shell.openExternal(url);
		return { action: "deny" };
	});
	mainWindow.webContents.on("will-navigate", (event, url) => {
		if (!url.startsWith("http://127.0.0.1:")) {
			event.preventDefault();
			void shell.openExternal(url);
		}
	});
	mainWindow.on("ready-to-show", () => mainWindow?.show());
	mainWindow.on("closed", () => {
		mainWindow = null;
		app.quit();
	});
	void mainWindow.loadURL(progressPage());
	return mainWindow;
}

function progressPage() {
	const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${appTitle}</title><style>
		:root{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;background:#111318;color:#edf0f4}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center}.status{width:min(520px,calc(100vw - 48px));border-left:3px solid #e34e66;padding:8px 0 8px 24px}h1{font-size:22px;font-weight:600;margin:0 0 12px}p{margin:0;color:#aab1bc;line-height:1.5;overflow-wrap:anywhere}.bar{height:3px;background:#292d35;margin-top:24px;overflow:hidden}.bar:after{content:"";display:block;width:35%;height:100%;background:#e34e66;animation:move 1.4s ease-in-out infinite alternate}@keyframes move{to{transform:translateX(190%)}}
		</style></head><body><main class="status"><h1>Starting ${appTitle}</h1><p id="status">Checking Docker Desktop...</p><div class="bar"></div></main></body></html>`;
	return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function runRuntimeCommand(command) {
	return new Promise((resolve) => {
		const child = spawn(bunExecutable, [runtimeBundle, command], {
			cwd: runtimeDirectory,
			env: runtimeEnvironment(),
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		for (const stream of [child.stdout, child.stderr]) {
			stream.setEncoding("utf8");
			stream.on("data", (chunk) => {
				output += chunk;
				if (output.length > 24000) output = output.slice(-24000);
			});
		}
		child.on("error", (error) => resolve({ code: 1, output: error.message }));
		child.on("close", (code) => resolve({ code: code ?? 1, output }));
	});
}

async function showDiagnostics(startupDetails = "") {
	const result = await runRuntimeCommand("diagnostics");
	const report = [
		result.output.trim(),
		startupDetails.trim() ? `Startup details:\n${startupDetails.trim()}` : "",
	]
		.filter(Boolean)
		.join("\n\n");
	const versionedReport = report.includes("CodeRunner version:")
		? report
		: `CodeRunner version: ${app.getVersion()}\n\n${report}`;
	const response = await dialog.showMessageBox(mainWindow, {
		type: result.code === 0 ? "info" : "warning",
		title: "CodeRunner diagnostics",
		message: "Review Docker and startup details before sharing this report.",
		detail: versionedReport || "No diagnostic output was produced.",
		buttons: ["Copy report", "Close"],
		defaultId: 1,
		cancelId: 1,
	});
	if (response.response === 0) clipboard.writeText(versionedReport);
}

async function repairRuntime() {
	setProgress("Repairing the local runtime...");
	const result = await runRuntimeCommand("repair");
	if (result.code === 0) {
		await dialog.showMessageBox(mainWindow, {
			type: "info",
			title: "Repair complete",
			message:
				"The local runtime is ready. Your project files were not changed.",
		});
		return;
	}
	await dialog.showMessageBox(mainWindow, {
		type: "error",
		title: "Repair failed",
		message: "CodeRunner could not repair the local runtime.",
		detail: result.output.trim(),
	});
}

async function handleStartupFailure(detail) {
	if (quitting || !mainWindow || mainWindow.isDestroyed()) return;
	const message = /Docker Desktop was not found|spawn .*ENOENT/iu.test(detail)
		? "Docker Desktop was not found. Install Docker Desktop, then restart CodeRunner."
		: /Please start Docker and restart CodeRunner|cannot connect to the Docker daemon|engine is unavailable/iu.test(
					detail,
				)
			? "Please start Docker and restart CodeRunner."
			: /Unable to download image/iu.test(detail)
				? "Unable to download image, try again."
				: "CodeRunner could not start. Check Docker Desktop or open Diagnostics for details.";
	const response = await dialog.showMessageBox(mainWindow, {
		type: "error",
		title: "CodeRunner could not start",
		message,
		detail: "Choose Diagnostics for detailed Docker and startup information.",
		buttons: ["Repair and retry", "Diagnostics", "Quit"],
		defaultId: 0,
		cancelId: 2,
	});
	if (response.response === 0) {
		const repair = await runRuntimeCommand("repair");
		if (repair.code === 0) {
			startRuntime();
		} else {
			await handleStartupFailure(repair.output || "Repair failed.");
		}
	} else if (response.response === 1) {
		await showDiagnostics(detail.slice(-6000));
	} else {
		app.quit();
	}
}

function startRuntime() {
	recentOutput.length = 0;
	runtimeUrl = null;
	setProgress("Checking Docker Desktop...");
	const child = spawn(bunExecutable, [runtimeBundle, "start"], {
		cwd: runtimeDirectory,
		env: {
			...runtimeEnvironment(),
			FRC_LAUNCH_GRANT: activeLaunchTicket ?? "",
		},
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	runtimeProcess = child;

	const consume = (stream) => {
		const reader = createInterface({ input: stream });
		reader.on("line", (line) => {
			appendOutput(line);
			const match =
				/Local CodeRunner is ready: (http:\/\/127\.0\.0\.1:\d+\/u\/demo\/)/u.exec(
					line,
				);
			if (match && !runtimeUrl) {
				runtimeUrl = match[1];
				void mainWindow?.loadURL(runtimeUrl);
			}
		});
	};
	consume(child.stdout);
	consume(child.stderr);
	child.on("error", (error) => {
		if (runtimeProcess === child) runtimeProcess = null;
		void handleStartupFailure(error.message);
	});
	child.on("close", (code) => {
		if (runtimeProcess === child) runtimeProcess = null;
		if (!quitting) {
			void handleStartupFailure(
				`Local runtime exited with status ${code ?? "unknown"}.\n${recentOutput.join("\n")}`,
			);
		}
	});
}

function installApplicationMenu() {
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{
				label: appTitle,
				submenu: [
					{ label: "Repair runtime", click: () => void repairRuntime() },
					{ label: "Collect diagnostics", click: () => void showDiagnostics() },
					{ type: "separator" },
					{ role: "quit", label: "Quit CodeRunner" },
				],
			},
		]),
	);
}

if (hasSingleInstance) {
	app.on("second-instance", () => {
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.focus();
		}
	});

	app.whenReady().then(() => {
		app.setName(appTitle);
		if (process.platform === "win32") {
			app.setAppUserModelId("edu.bobcatrobotics.coderunner");
		}
		installApplicationMenu();
		createWindow();
		void startAfterAuthorization();
	});

	app.on("before-quit", () => {
		quitting = true;
		if (runtimeProcess) runtimeProcess.kill();
	});

	app.on("window-all-closed", () => app.quit());
}
