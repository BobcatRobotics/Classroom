import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { login, withApp } from "./helpers";

async function issueLaunchTicket(
	app: Parameters<Parameters<typeof withApp>[0]>[0],
): Promise<string> {
	await login(app, "alice");
	const user = app.storage.db
		.query("SELECT id FROM user WHERE email = ?")
		.get("alice@test.local") as { id: string };
	const now = new Date().toISOString();
	app.storage.db
		.query(
			"INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt) VALUES (?, ?, 'github', ?, ?, ?)",
		)
		.run(randomBytes(16).toString("hex"), "alice-github", user.id, now, now);
	const ticket = randomBytes(32).toString("base64url");
	const ticketHash = createHash("sha256").update(ticket).digest("base64url");
	app.storage.db
		.query(
			"INSERT INTO launcher_runtime_grants (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
		)
		.run(ticketHash, user.id, new Date(Date.now() + 60_000).toISOString());
	return ticket;
}

describe("GET /api/launcher/catalog-config", () => {
	test("returns the configured remote repository only to a valid launcher", async () => {
		await withApp(
			async (app) => {
				const ticket = await issueLaunchTicket(app);
				const response = await app.fetch(
					new Request("http://localhost/api/launcher/catalog-config", {
						headers: { authorization: `Bearer ${ticket}` },
					}),
				);

				expect(response.status).toBe(200);
				expect(response.headers.get("cache-control")).toBe("no-store");
				expect(await response.json()).toEqual({
					ok: true,
					catalogRepo: "team/lessons",
					catalogBranch: "2027",
				});
			},
			{ catalogRepo: "team/lessons", catalogBranch: "2027" },
		);
	});

	test("rejects an invalid launch grant", async () => {
		await withApp(async (app) => {
			const response = await app.fetch(
				new Request("http://localhost/api/launcher/catalog-config", {
					headers: { authorization: `Bearer ${"a".repeat(43)}` },
				}),
			);
			expect(response.status).toBe(401);
		});
	});
});

describe("POST /api/launcher/lesson-completions", () => {
	test("stores a desktop completion for the ticket owner and deduplicates retry", async () => {
		await withApp(async (app) => {
			const ticket = await issueLaunchTicket(app);
			const request = () =>
				app.fetch(
					new Request("http://localhost/api/launcher/lesson-completions", {
						method: "POST",
						headers: {
							authorization: `Bearer ${ticket}`,
							"content-type": "application/json",
						},
						body: JSON.stringify({
							eventId: `completion_${"b".repeat(32)}`,
							moduleId: "robot-starter",
							testsTotal: 3,
							testsPassed: 3,
							testsFailed: 0,
							testsSkipped: 0,
						}),
					}),
				);

			const first = await request();
			const firstBody = (await first.json()) as { completionId: string };
			expect(first.status).toBe(200);
			expect(first.headers.get("cache-control")).toBe("no-store");

			const retry = await request();
			const retryBody = (await retry.json()) as { completionId: string };
			expect(retry.status).toBe(200);
			expect(retryBody.completionId).toBe(firstBody.completionId);

			const row = app.storage.db
				.query(
					"SELECT student_id, workspace_id, run_job_id, source FROM lesson_completions WHERE id = ?",
				)
				.get(firstBody.completionId) as {
				student_id: string;
				workspace_id: string | null;
				run_job_id: string | null;
				source: string;
			};
			expect(row).toMatchObject({
				workspace_id: null,
				run_job_id: null,
				source: "desktop",
			});
			expect(
				app.storage.db
					.query("SELECT COUNT(*) AS count FROM lesson_completions")
					.get(),
			).toEqual({ count: 1 });
			expect(row.student_id).toBe(
				(
					app.storage.db
						.query("SELECT id FROM user WHERE email = ?")
						.get("alice@test.local") as { id: string }
				).id,
			);
		});
	});

	test("rejects a desktop completion for a plain Java lesson", async () => {
		await withApp(async (app) => {
			const ticket = await issueLaunchTicket(app);
			const response = await app.fetch(
				new Request("http://localhost/api/launcher/lesson-completions", {
					method: "POST",
					headers: {
						authorization: `Bearer ${ticket}`,
						"content-type": "application/json",
					},
					body: JSON.stringify({
						eventId: `completion_${"c".repeat(32)}`,
						moduleId: "hello-world",
						testsTotal: 1,
						testsPassed: 1,
						testsFailed: 0,
						testsSkipped: 0,
					}),
				}),
			);
			expect(response.status).toBe(409);
		});
	});
});
