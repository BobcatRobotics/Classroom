import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fetchPathPlannerDist } from "../../../scripts/fetch-pathplanner-dist";

const launcherDir = resolve(import.meta.dir, "..");
const repoRoot = resolve(launcherDir, "../..");
const distDir = resolve(launcherDir, "dist", "advantagescope");
const DEFAULT_ASCOPE_RELEASE_TAG = "v27.0.0-alpha-6";

export function assertAscopeReleaseTag(
	version: string,
	releaseTag = Bun.env.ASCOPE_RELEASE_TAG,
): void {
	const expectedVersion = (
		releaseTag?.trim() || DEFAULT_ASCOPE_RELEASE_TAG
	).replace(/^v/u, "");
	if (version !== expectedVersion) {
		throw new Error(
			`AdvantageScope pin mismatch: ASCOPE_RELEASE_TAG expects ${expectedVersion}, but vendor/AdvantageScope is ${version}.`,
		);
	}
}

async function checkAscopeSourceVersion(): Promise<void> {
	const manifestPath = resolve(
		repoRoot,
		"vendor",
		"AdvantageScope",
		"package.json",
	);
	const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
		version?: unknown;
	};
	if (typeof manifest.version !== "string") {
		throw new Error("vendor/AdvantageScope/package.json has no version.");
	}
	assertAscopeReleaseTag(manifest.version);
	console.log(`Using AdvantageScope source v${manifest.version}`);
}

async function build(): Promise<void> {
	await checkAscopeSourceVersion();
	const docker = Bun.env.FRC_DOCKER_PATH?.trim() || "docker";
	const args = [
		"buildx",
		"build",
		"--platform",
		"linux/amd64",
		"--file",
		"containers/control/Dockerfile",
		"--target",
		"ascope-dist",
		"--output",
		`type=local,dest=${distDir}`,
	];
	const releaseTag = Bun.env.ASCOPE_RELEASE_TAG?.trim();
	if (releaseTag) args.push("--build-arg", `ASCOPE_RELEASE_TAG=${releaseTag}`);
	args.push(".");

	await rm(distDir, { recursive: true, force: true });
	await mkdir(dirname(distDir), { recursive: true });
	console.log(`Exporting AdvantageScope Lite to ${distDir}`);
	const subprocess = Bun.spawn([docker, ...args], {
		cwd: repoRoot,
		stdout: "inherit",
		stderr: "inherit",
		stdin: "ignore",
	});
	const exitCode = await subprocess.exited;
	if (exitCode !== 0) {
		throw new Error(
			`Docker AdvantageScope export failed with exit ${exitCode}.`,
		);
	}
	await fetchPathPlannerDist({
		optional: true,
		distDir: resolve(launcherDir, "dist"),
	});
}

if (import.meta.main) {
	try {
		await build();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
