import { describe, expect, test } from "bun:test";
import { assertAscopeReleaseTag } from "./build-ascope-dist";

describe("desktop AdvantageScope source pin", () => {
	test("accepts a tag matching the checked-out submodule version", () => {
		expect(() =>
			assertAscopeReleaseTag("27.0.0-alpha-6", "v27.0.0-alpha-6"),
		).not.toThrow();
	});

	test("rejects a tag that does not match the checked-out submodule version", () => {
		expect(() => assertAscopeReleaseTag("27.0.0-alpha-6", "v26.0.2")).toThrow(
			"vendor/AdvantageScope is 27.0.0-alpha-6",
		);
	});
});
