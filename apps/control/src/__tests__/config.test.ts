import { describe, expect, test } from "bun:test";
import { loadControlConfig } from "../config";

describe("parseBoolean (via loadControlConfig)", () => {
	test("empty string falls back to the default for demo (false)", () => {
		expect(loadControlConfig({ demo: "" }).demo).toBe(false);
	});

	test("whitespace-only string falls back to the default for demo (false)", () => {
		expect(loadControlConfig({ demo: "  " }).demo).toBe(false);
	});

	test("empty string falls back to the default for containerAutoStart (true)", () => {
		expect(
			loadControlConfig({ containerAutoStart: "" }).containerAutoStart,
		).toBe(true);
	});

	test("whitespace-only string falls back to the default for containerAutoStart (true)", () => {
		expect(
			loadControlConfig({ containerAutoStart: "  " }).containerAutoStart,
		).toBe(true);
	});

	test('"0" and "false" still parse as false, overriding a true fallback', () => {
		expect(
			loadControlConfig({ containerAutoStart: "0" }).containerAutoStart,
		).toBe(false);
		expect(
			loadControlConfig({ containerAutoStart: "false" }).containerAutoStart,
		).toBe(false);
	});

	test('"1" still parses as true, overriding a false fallback', () => {
		expect(loadControlConfig({ demo: "1" }).demo).toBe(true);
	});
});

describe("containerNetwork (via loadControlConfig)", () => {
	test("empty string is treated as unset (port mode), not a network name", () => {
		expect(loadControlConfig({ containerNetwork: "" }).containerNetwork).toBe(
			null,
		);
	});

	test("whitespace-only string is treated as unset", () => {
		expect(loadControlConfig({ containerNetwork: "  " }).containerNetwork).toBe(
			null,
		);
	});

	test("a real network name is trimmed and kept", () => {
		expect(
			loadControlConfig({ containerNetwork: " coderunner " }).containerNetwork,
		).toBe("coderunner");
	});
});

describe("adminEmails (via loadControlConfig)", () => {
	test("unset input falls back to an empty list", () => {
		expect(loadControlConfig({}).adminEmails).toEqual([]);
	});

	test("a single email is parsed into a one-entry list", () => {
		expect(
			loadControlConfig({ adminEmails: "coach@team.org" }).adminEmails,
		).toEqual(["coach@team.org"]);
	});

	test("a comma list is split, trimmed, and lowercased", () => {
		expect(
			loadControlConfig({
				adminEmails: " Coach@Team.org , Assistant@Team.org ",
			}).adminEmails,
		).toEqual(["coach@team.org", "assistant@team.org"]);
	});

	test("empty entries are dropped", () => {
		expect(
			loadControlConfig({ adminEmails: "coach@team.org,, ,\t" }).adminEmails,
		).toEqual(["coach@team.org"]);
	});

	test("an empty string yields an empty list", () => {
		expect(loadControlConfig({ adminEmails: "" }).adminEmails).toEqual([]);
	});

	test("a string[] input is normalized the same way", () => {
		expect(
			loadControlConfig({
				adminEmails: ["Coach@Team.org", " ", "assistant@team.org"],
			}).adminEmails,
		).toEqual(["coach@team.org", "assistant@team.org"]);
	});
});
