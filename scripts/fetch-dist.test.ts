import { describe, expect, test } from "bun:test";
import { distArtifacts } from "./fetch-dist";

describe("fetch distribution artifacts", () => {
	test("can skip the release web shell while keeping AdvantageScope", () => {
		expect(distArtifacts(true).map(({ asset }) => asset)).toEqual([
			"ascope-dist.tar.gz",
		]);
	});

	test("downloads the web shell by default", () => {
		expect(distArtifacts(false).map(({ asset }) => asset)).toEqual([
			"ascope-dist.tar.gz",
			"web-dist.tar.gz",
		]);
	});

	test("supports a separate distribution output directory", () => {
		expect(
			distArtifacts(true, "/tmp/launcher-dist").map(({ destDir }) => destDir),
		).toEqual(["/tmp/launcher-dist/advantagescope"]);
	});
});
