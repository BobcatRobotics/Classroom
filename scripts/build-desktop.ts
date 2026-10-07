import {
	chmod,
	copyFile,
	cp,
	mkdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { BICUBIC, createICNS, createICO } from "png2icons";

const root = resolve(import.meta.dir, "..");
const desktopDir = join(root, "dist", "desktop");
const resourcesDir = join(desktopDir, "resources");
const iconDir = join(desktopDir, "icons");

function assertSupportedBuildHost(): void {
	const supported =
		(process.platform === "darwin" &&
			(process.arch === "arm64" || process.arch === "x64")) ||
		(process.platform === "win32" && process.arch === "x64");
	if (!supported) {
		throw new Error(
			`Desktop packaging is supported on macOS arm64/x64 and Windows x64, not ${process.platform}/${process.arch}.`,
		);
	}
}

function checkSigningRequirements(): void {
	const missing: string[] = [];
	if (!Bun.env.CSC_LINK) missing.push("CSC_LINK");
	if (!Bun.env.CSC_KEY_PASSWORD) missing.push("CSC_KEY_PASSWORD");
	if (process.platform === "darwin") {
		for (const variable of [
			"APPLE_ID",
			"APPLE_APP_SPECIFIC_PASSWORD",
			"APPLE_TEAM_ID",
		]) {
			if (!Bun.env[variable]) missing.push(variable);
		}
	}
	if (missing.length > 0) {
		throw new Error(
			`Signed desktop release requires secure environment variables: ${missing.join(", ")}. Do not put signing credentials in source files.`,
		);
	}
}

async function copyDirectory(
	source: string,
	destination: string,
): Promise<void> {
	try {
		await cp(source, destination, { recursive: true, force: true });
	} catch (error) {
		throw new Error(
			`Required desktop asset directory is missing: ${source}. Build web assets and run bun run fetch:dist first.`,
			{ cause: error },
		);
	}
}

async function buildIcons(): Promise<void> {
	const png = await readFile(
		join(root, "apps", "web", "public", "coderunner-icon.png"),
	);
	const icns = createICNS(png, BICUBIC, 0);
	const ico = createICO(png, BICUBIC, 0, false, true);
	if (!icns || !ico) {
		throw new Error(
			"Unable to create CodeRunner desktop icons from the PNG source.",
		);
	}
	await writeFile(join(iconDir, "coderunner.icns"), icns);
	await writeFile(join(iconDir, "coderunner.ico"), ico);
}

async function prepare(): Promise<void> {
	assertSupportedBuildHost();
	const bunExecutable = Bun.which("bun");
	if (!bunExecutable) throw new Error("Bun was not found on PATH.");

	await rm(desktopDir, { recursive: true, force: true });
	await mkdir(join(resourcesDir, "bin"), { recursive: true });
	await mkdir(iconDir, { recursive: true });

	const runtimeBundle = join(resourcesDir, "local-runtime.js");
	const build = Bun.spawnSync(
		[
			bunExecutable,
			"build",
			"--target=bun",
			`--outfile=${runtimeBundle}`,
			"scripts/local-runtime.ts",
		],
		{ cwd: root, stdout: "inherit", stderr: "inherit" },
	);
	if (build.exitCode !== 0) {
		throw new Error(
			`Bundling the local runtime failed with exit ${build.exitCode}.`,
		);
	}

	const bunName = process.platform === "win32" ? "bun.exe" : "bun";
	const bundledBun = join(resourcesDir, "bin", bunName);
	await copyFile(bunExecutable, bundledBun);
	if (process.platform !== "win32") await chmod(bundledBun, 0o755);

	const resourceDirectories: Array<[string, string]> = [
		["apps/web/dist", "web"],
		["dist/advantagescope", "advantagescope"],
		["dist/pathplanner", "pathplanner"],
		["catalog", "catalog"],
		["apps/control/migrations", "migrations"],
	];
	for (const [source, destination] of resourceDirectories) {
		await copyDirectory(join(root, source), join(resourcesDir, destination));
	}
	await buildIcons();
	console.log(`Desktop resources staged in ${desktopDir}`);
}

try {
	if (Bun.argv.includes("--check-signing")) {
		checkSigningRequirements();
		console.log("Signing environment is configured for this platform.");
	} else {
		await prepare();
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
