import { describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageTeamAssets } from "./build-ascope-lite";

async function writeAsset(
	root: string,
	name: string,
	config: string,
	assetFile = "model.glb",
): Promise<void> {
	const assetDir = join(root, name);
	await mkdir(assetDir, { recursive: true });
	await writeFile(join(assetDir, "config.json"), config);
	await writeFile(join(assetDir, assetFile), "asset");
}

describe("AdvantageScope team asset staging", () => {
	test("copies valid repository-owned assets into bundledAssets", async () => {
		const root = await mkdtemp(join(tmpdir(), "coderunner-ascope-assets-"));
		try {
			const source = join(root, "source");
			const target = join(root, "bundledAssets");
			await writeAsset(source, "Robot_Team177", '{"name":"Team 177 Robot"}');
			await writeFile(join(source, ".DS_Store"), "ignored");

			await stageTeamAssets(source, target);

			await access(join(target, "Robot_Team177", "config.json"));
			await access(join(target, "Robot_Team177", "model.glb"));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("rejects an asset missing its required model", async () => {
		const root = await mkdtemp(join(tmpdir(), "coderunner-ascope-assets-"));
		try {
			const source = join(root, "source");
			await writeAsset(
				source,
				"Robot_Team177",
				'{"name":"Team 177 Robot"}',
				"not-a-model.txt",
			);

			await expect(
				stageTeamAssets(source, join(root, "target")),
			).rejects.toThrow("missing model.glb");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
