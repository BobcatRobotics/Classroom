#!/usr/bin/env bun
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Downloads the prebuilt release artifacts (web shell + AdvantageScope Lite)
// instead of building them from source. This is the demo/quick-start path: it
// skips the emscripten-dependent `build:ascope` compile entirely by reusing the
// `ascope-dist.tar.gz` and `web-dist.tar.gz` already published on each release.
// The GCE deploy does the same thing (see .github/workflows/deploy.yml).

const repoRoot = resolve(import.meta.dirname, "..");

// Overridable so forks can point at their own releases.
const repo = Bun.env.DEMO_RELEASE_REPO ?? "mathewdunne/CodeRunner";

// Default to the newest published release. Pass `--tag vX.Y.Z` to pin.
const tagArgIndex = Bun.argv.indexOf("--tag");
const tag =
	tagArgIndex >= 0
		? Bun.argv[tagArgIndex + 1]
		: (Bun.env.DEMO_RELEASE_TAG ?? "");

type Artifact = { asset: string; destDir: string };

const artifacts: Artifact[] = [
	{
		asset: "ascope-dist.tar.gz",
		destDir: resolve(repoRoot, "dist/advantagescope"),
	},
	{ asset: "web-dist.tar.gz", destDir: resolve(repoRoot, "apps/web/dist") },
];

function downloadUrl(asset: string): string {
	const base = `https://github.com/${repo}/releases`;
	return tag
		? `${base}/download/${tag}/${asset}`
		: `${base}/latest/download/${asset}`;
}

async function run(command: string, args: string[]): Promise<void> {
	const subprocess = Bun.spawn([command, ...args], {
		stdout: "inherit",
		stderr: "inherit",
		stdin: "ignore",
	});
	const exitCode = await subprocess.exited;
	if (exitCode !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed with exit ${exitCode}.`,
		);
	}
}

async function fetchAndExtract(
	artifact: Artifact,
	scratch: string,
): Promise<void> {
	const url = downloadUrl(artifact.asset);
	console.log(`\nDownloading ${artifact.asset} from ${url}`);
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`Failed to download ${artifact.asset}: ${response.status} ${response.statusText}. ` +
				`Check that release ${tag || "latest"} exists for ${repo} and includes this asset.`,
		);
	}

	const tarPath = join(scratch, artifact.asset);
	await writeFile(tarPath, Buffer.from(await response.arrayBuffer()));

	// Reset the destination so a re-fetch never mixes old and new files. `tar` is
	// available on Windows 11, macOS, and Linux.
	await rm(artifact.destDir, { recursive: true, force: true });
	await mkdir(artifact.destDir, { recursive: true });
	await run("tar", ["-xzf", tarPath, "-C", artifact.destDir]);
	console.log(`Extracted ${artifact.asset} -> ${artifact.destDir}`);
}

async function main(): Promise<void> {
	console.log(
		`Fetching prebuilt dist artifacts from ${repo} (${tag || "latest release"}).`,
	);
	const scratch = await mkdtemp(join(tmpdir(), "coderunner-dist-"));
	try {
		for (const artifact of artifacts) {
			await fetchAndExtract(artifact, scratch);
		}
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
	console.log("\nPrebuilt web shell and AdvantageScope Lite assets are ready.");
}

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
