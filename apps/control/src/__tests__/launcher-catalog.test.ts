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
