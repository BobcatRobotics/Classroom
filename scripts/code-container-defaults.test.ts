import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const initScript = resolve(
	repoRoot,
	"containers/code/root/etc/s6-overlay/s6-rc.d/init-frc-setup/run",
);

describe("Code container VS Code defaults", () => {
	test("adds the WPILib wrapper alias to existing Gradle homes", async () => {
		const contents = await readFile(initScript, "utf8");

		expect(contents).toContain(
			'ln -s wrapper "$' + '{GRADLE_USER_HOME}/permwrapper"',
		);
	});

	test("seeds workbench and Java defaults as remote machine settings", async () => {
		const contents = await readFile(initScript, "utf8");

		expect(contents).toContain(
			'MACHINE_SETTINGS="$' + '{HOME}/data/Machine/settings.json"',
		);
		expect(contents).toContain(
			'"workbench.colorTheme" //= "Default Dark Modern"',
		);
		expect(contents).toContain(
			'merge_vscode_settings "$' + '{MACHINE_SETTINGS}" defaults',
		);
		expect(contents).not.toContain("USER_SETTINGS=");
	});
});
