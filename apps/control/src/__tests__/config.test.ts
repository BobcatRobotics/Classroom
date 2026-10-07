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

describe("desktop launch grant TTL", () => {
	test("defaults to one hour", () => {
		expect(loadControlConfig({ adminEmails: [] }).desktopLaunchGrantTtlMs).toBe(
			60 * 60 * 1000,
		);
	});

	test("accepts a value from one minute through 24 hours", () => {
		expect(
			loadControlConfig({
				adminEmails: [],
				desktopLaunchGrantTtlMs: 2 * 60 * 60 * 1000,
			}).desktopLaunchGrantTtlMs,
		).toBe(2 * 60 * 60 * 1000);
	});

	test("rejects values outside the supported range", () => {
		expect(() =>
			loadControlConfig({ adminEmails: [], desktopLaunchGrantTtlMs: 30_000 }),
		).toThrow("CODERUNNER_DESKTOP_LAUNCH_GRANT_TTL_MS");
		expect(() =>
			loadControlConfig({
				adminEmails: [],
				desktopLaunchGrantTtlMs: 25 * 60 * 60 * 1000,
			}),
		).toThrow("CODERUNNER_DESKTOP_LAUNCH_GRANT_TTL_MS");
	});
});

describe("local desktop identity", () => {
	const identity = {
		displayName: "Student Example",
		email: "student@example.test",
		avatarUrl: null,
		role: "student" as const,
	};

	test("defaults to no local identity", () => {
		expect(loadControlConfig({ localIdentity: null }).localIdentity).toBeNull();
	});

	test("accepts a validated local identity", () => {
		expect(
			loadControlConfig({ localIdentity: identity }).localIdentity,
		).toEqual(identity);
	});

	test("rejects a malformed local identity from the environment", () => {
		const original = Bun.env.CODERUNNER_LOCAL_IDENTITY;
		Bun.env.CODERUNNER_LOCAL_IDENTITY = "not-json";
		try {
			expect(() => loadControlConfig({ localIdentity: null })).not.toThrow();
			expect(() => loadControlConfig({})).toThrow(
				"CODERUNNER_LOCAL_IDENTITY must contain valid JSON.",
			);
		} finally {
			if (original === undefined) delete Bun.env.CODERUNNER_LOCAL_IDENTITY;
			else Bun.env.CODERUNNER_LOCAL_IDENTITY = original;
		}
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

describe("codeDiskReadLimit (via loadControlConfig)", () => {
	test("defaults to 64mb", () => {
		expect(loadControlConfig({}).codeDiskReadLimit).toBe("64mb");
	});

	test("accepts a Docker byte rate and normalizes case", () => {
		expect(
			loadControlConfig({ codeDiskReadLimit: "100MB" }).codeDiskReadLimit,
		).toBe("100mb");
	});

	test('"0" and "off" disable the limit', () => {
		expect(
			loadControlConfig({ codeDiskReadLimit: "0" }).codeDiskReadLimit,
		).toBe(null);
		expect(
			loadControlConfig({ codeDiskReadLimit: "off" }).codeDiskReadLimit,
		).toBe(null);
	});

	test("empty string means unset and falls back to the default", () => {
		expect(loadControlConfig({ codeDiskReadLimit: "" }).codeDiskReadLimit).toBe(
			"64mb",
		);
	});

	test("explicit null disables the limit", () => {
		expect(
			loadControlConfig({ codeDiskReadLimit: null }).codeDiskReadLimit,
		).toBe(null);
	});

	test("rejects values Docker would not accept", () => {
		expect(() => loadControlConfig({ codeDiskReadLimit: "fast" })).toThrow(
			/CODE_DISK_READ_LIMIT/,
		);
		expect(() => loadControlConfig({ codeDiskReadLimit: "64 mb" })).toThrow(
			/CODE_DISK_READ_LIMIT/,
		);
	});
});
