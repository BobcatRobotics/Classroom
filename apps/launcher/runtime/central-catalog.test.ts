import { describe, expect, test } from "bun:test";
import { configureCentralCatalog } from "./central-catalog";

const launchTicket = "a".repeat(43);

describe("configureCentralCatalog", () => {
	test("applies the central repository and branch to the local runtime", async () => {
		const environment: Record<string, string | undefined> = {
			CODERUNNER_CENTRAL_URL: "https://coderunner.example/",
			FRC_LAUNCH_GRANT: launchTicket,
		};
		let requestedUrl = "";
		let authorization = "";
		const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
			requestedUrl = String(input);
			authorization = new Headers(init?.headers).get("authorization") ?? "";
			return Response.json({
				ok: true,
				catalogRepo: "team/lessons",
				catalogBranch: "2027",
			});
		}) as unknown as typeof fetch;

		await configureCentralCatalog(environment, fetchImpl);

		expect(requestedUrl).toBe(
			"https://coderunner.example/api/launcher/catalog-config",
		);
		expect(authorization).toBe(`Bearer ${launchTicket}`);
		expect(environment.LESSONS_CATALOG_REPO).toBe("team/lessons");
		expect(environment.LESSONS_CATALOG_BRANCH).toBe("2027");
	});

	test("clears inherited remote settings when central uses the bundled catalog", async () => {
		const environment: Record<string, string | undefined> = {
			CODERUNNER_CENTRAL_URL: "https://coderunner.example",
			FRC_LAUNCH_GRANT: launchTicket,
			LESSONS_CATALOG_REPO: "old/team-lessons",
			LESSONS_CATALOG_BRANCH: "old",
		};
		const fetchImpl = (async () =>
			Response.json({
				ok: true,
				catalogRepo: null,
				catalogBranch: null,
			})) as unknown as typeof fetch;

		await configureCentralCatalog(environment, fetchImpl);

		expect(environment.LESSONS_CATALOG_REPO).toBeUndefined();
		expect(environment.LESSONS_CATALOG_BRANCH).toBeUndefined();
	});

	test("does not accept an untrusted central origin", async () => {
		const environment = {
			CODERUNNER_CENTRAL_URL: "http://lessons.example",
			FRC_LAUNCH_GRANT: launchTicket,
		};
		await expect(configureCentralCatalog(environment)).rejects.toThrow(
			"trusted HTTPS",
		);
	});

	test("does not silently fall back when the central lookup fails", async () => {
		const environment = {
			CODERUNNER_CENTRAL_URL: "https://coderunner.example",
			FRC_LAUNCH_GRANT: launchTicket,
		};
		const fetchImpl = (async () =>
			new Response(null, { status: 401 })) as unknown as typeof fetch;

		await expect(
			configureCentralCatalog(environment, fetchImpl),
		).rejects.toThrow("could not load the central lesson catalog");
	});
});
