import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import {
	addAllowlistEntry,
	isEmailAllowed,
	loadAllowlist,
	setAllowlistPath,
} from "../auth/allowlist";
import {
	cookieFrom,
	createAdvantageScopeDist,
	createCatalogDir,
	createWebDist,
	exists,
	login,
	withApp,
} from "./helpers";

describe("session login and ownership", () => {
	test("new login creates a user, workspace, session, and an empty project dir", async () => {
		await withApp(async (app) => {
			const response = await login(app, "alice");
			expect(response.status).toBe(303);
			expect(response.headers.get("location")).toBe("/u/alice/");

			const userCount = app.storage.db
				.query("SELECT COUNT(*) AS count FROM user")
				.get() as { count: number };
			const workspaceCount = app.storage.db
				.query("SELECT COUNT(*) AS count FROM workspaces")
				.get() as {
				count: number;
			};
			const sessionCount = app.storage.db
				.query("SELECT COUNT(*) AS count FROM session")
				.get() as {
				count: number;
			};
			const workspace = app.storage.db
				.query("SELECT * FROM workspaces WHERE slug = ?")
				.get("alice") as {
				project_path: string;
				current_module: string | null;
				current_module_kind: string | null;
			};

			expect(userCount.count).toBe(1);
			expect(workspaceCount.count).toBe(1);
			expect(sessionCount.count).toBe(1);

			// The project dir exists but is EMPTY (no first-login template seed):
			// the student fills it from the lesson picker (Decision 029 / D7).
			expect(await exists(workspace.project_path)).toBe(true);
			const { readdir } = await import("node:fs/promises");
			expect((await readdir(workspace.project_path)).length).toBe(0);
			expect(workspace.current_module).toBeNull();
			expect(workspace.current_module_kind).toBeNull();
		});
	});

	test("session cookie redirects to the existing workspace", async () => {
		await withApp(async (app) => {
			const response = await login(app, "alice");
			const cookie = cookieFrom(response);

			const reload = await app.fetch(
				new Request("http://localhost/", {
					headers: { cookie },
				}),
			);
			expect(reload.status).toBe(303);
			expect(reload.headers.get("location")).toBe("/u/alice/");

			const workspace = await app.fetch(
				new Request("http://localhost/u/alice/", {
					headers: { cookie },
				}),
			);
			expect(workspace.status).toBe(200);
			expect(await workspace.text()).toContain("V2 test shell");
		});
	});

	test("rejects bad workspace slugs before serving a workspace page", async () => {
		await withApp(async (app) => {
			const response = await login(app, "alice");
			const cookie = cookieFrom(response);

			const badSlug = await app.fetch(
				new Request("http://localhost/u/alice.bob/", {
					headers: { cookie },
				}),
			);

			expect(badSlug.status).toBe(400);
		});
	});

	test("prevents another session from accessing a different user's workspace", async () => {
		await withApp(async (app) => {
			const alice = await login(app, "alice");
			const aliceCookie = cookieFrom(alice);

			await login(app, "bob");

			// Alice's cookie should not let her access Bob's workspace
			const bobAsAlice = await app.fetch(
				new Request("http://localhost/u/bob/", {
					headers: { cookie: aliceCookie },
				}),
			);
			expect(bobAsAlice.status).toBe(403);
		});
	});

	test("returning user gets a fresh session with same workspace", async () => {
		await withApp(async (app) => {
			const first = await login(app, "alice");
			expect(first.status).toBe(303);
			expect(first.headers.get("location")).toBe("/u/alice/");

			// Second login with same display name → same user + new session
			const second = await login(app, "alice");
			expect(second.status).toBe(303);
			expect(second.headers.get("location")).toBe("/u/alice/");

			// Should have 1 user, 2 sessions, 1 workspace
			const userCount = app.storage.db
				.query("SELECT COUNT(*) AS count FROM user")
				.get() as { count: number };
			const sessionCount = app.storage.db
				.query("SELECT COUNT(*) AS count FROM session")
				.get() as {
				count: number;
			};
			const workspaceCount = app.storage.db
				.query("SELECT COUNT(*) AS count FROM workspaces")
				.get() as {
				count: number;
			};
			expect(userCount.count).toBe(1);
			expect(sessionCount.count).toBe(2);
			expect(workspaceCount.count).toBe(1);
		});
	});
});

describe("workspace creation concurrency", () => {
	test("concurrent first-logins with the same base slug get distinct slugs", async () => {
		await withApp(async (app) => {
			const now = new Date().toISOString();
			const insertUser = app.storage.db.query(
				"INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, role, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			);

			const ids = ["userAAAAAAAAAAAAAAAA", "userBBBBBBBBBBBBBBBB"];
			ids.forEach((id, i) => {
				insertUser.run(
					id,
					`Alice${i}`,
					`alice${i}@example.com`,
					0,
					null,
					now,
					now,
					"student",
					"alice",
				);
			});

			const results = await Promise.all(
				ids.map((id) => app.storage.ensureWorkspaceForUser(id, "alice")),
			);
			const slugs = results.map((w) => w.slug);

			expect(slugs[0]).not.toBe(slugs[1]);
			expect(new Set(slugs)).toEqual(new Set(["alice", "alice-1"]));

			const workspaceCount = app.storage.db
				.query("SELECT COUNT(*) AS count FROM workspaces")
				.get() as {
				count: number;
			};
			expect(workspaceCount.count).toBe(2);
		});
	});
});

describe("allowlist enforcement", () => {
	test("empty allowlist blocks OAuth emails until a matching entry is added", async () => {
		const root = await mkdtemp(join(tmpdir(), "frc-allowlist-"));
		try {
			setAllowlistPath(root);
			await loadAllowlist();
			expect(isEmailAllowed("student@example.com")).toBe(false);

			await addAllowlistEntry("domain", "example.com");
			expect(isEmailAllowed("student@example.com")).toBe(true);
			expect(isEmailAllowed("student@other.test")).toBe(false);

			await addAllowlistEntry("email", "coach@other.test");
			expect(isEmailAllowed("coach@other.test")).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("allowlist reload on sign-in", () => {
	type CreateBeforeHook = (user: {
		email: string;
		name: string;
	}) => Promise<{ data: { role: string; slug: string } } | undefined>;

	test("a CLI-written allowlist.json is picked up by the sign-in hook without an explicit reload call", async () => {
		await withApp(async (app) => {
			// Simulate `coderunner allowlist add` running as a separate process: it
			// writes allowlist.json directly on disk, bypassing addAllowlistEntry
			// (which would also update this process's in-memory cache).
			const allowlistPath = join(app.storage.config.dataDir, "allowlist.json");
			await writeFile(
				allowlistPath,
				JSON.stringify({ emails: ["late@test.local"], domains: [] }, null, 2),
				"utf8",
			);

			// The in-memory cache is stale until something reloads it.
			expect(isEmailAllowed("late@test.local")).toBe(false);

			const hook = app.storage.auth.options.databaseHooks?.user?.create
				?.before as unknown as CreateBeforeHook | undefined;
			const result = await hook?.({
				email: "late@test.local",
				name: "Late",
			});

			// The hook reloads from disk before checking, so the CLI's write takes
			// effect on this very sign-in attempt.
			expect(result?.data.role).toBe("student");
		});
	});
});

describe("bootstrap admin (CODERUNNER_ADMIN_EMAIL)", () => {
	type CreateBeforeHook = (user: {
		email: string;
		name: string;
	}) => Promise<{ data: { role: string; slug: string } } | undefined>;

	test("user.create hook grants admin to listed emails and student to others", async () => {
		await withApp(
			async (app) => {
				// The student email must be on the allowlist so the hook's roster gate
				// passes; the admin email was seeded into the allowlist at startup.
				await addAllowlistEntry("email", "student@test.local");

				const hook = app.storage.auth.options.databaseHooks?.user?.create
					?.before as unknown as CreateBeforeHook | undefined;
				expect(hook).toBeTruthy();

				// Mixed-case listed email still resolves to admin (case-insensitive).
				const adminResult = await hook?.({
					email: "Coach@Test.local",
					name: "Coach",
				});
				expect(adminResult?.data.role).toBe("admin");

				const studentResult = await hook?.({
					email: "student@test.local",
					name: "Student",
				});
				expect(studentResult?.data.role).toBe("student");
			},
			{ adminEmails: ["coach@test.local"] },
		);
	});

	test("startup seeding is idempotent, promotes existing students, leaves admins", async () => {
		const root = await mkdtemp(join(tmpdir(), "frc-bootstrap-"));
		try {
			const catalogDir = await createCatalogDir(root);
			const webDistDir = await createWebDist(root);
			const advantageScopeDistDir = await createAdvantageScopeDist(root);
			const dataDir = join(root, "data");
			const allowlistPath = join(dataDir, "allowlist.json");
			const baseOptions = {
				dataDir,
				catalogDir,
				webDistDir,
				advantageScopeDistDir,
				sessionSecret: "test-session-secret",
				baseUrl: "http://localhost:4000",
				containerAutoStart: false,
				adminEmails: ["coach@team.org", "boss@team.org"],
			};

			// First startup: both admin emails are seeded into the allowlist.
			const first = await createApp(baseOptions);
			const afterFirst = JSON.parse(await readFile(allowlistPath, "utf8")) as {
				emails: string[];
			};
			expect(afterFirst.emails).toEqual(["boss@team.org", "coach@team.org"]);

			// Simulate accounts that already exist: a coach who signed in as a
			// student before the env was set (with the mixed-case email the OAuth
			// provider returned — promotion must match case-insensitively), and a
			// boss who is already an admin.
			const staleAdminTimestamp = "2020-01-01T00:00:00.000Z";
			const insertUser = first.storage.db.query(
				"INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, role, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			);
			insertUser.run(
				"userCoachAAAAAAAAAAA",
				"Coach",
				"Coach@Team.org",
				0,
				null,
				staleAdminTimestamp,
				staleAdminTimestamp,
				"student",
				"coach",
			);
			insertUser.run(
				"userBossBBBBBBBBBBBB",
				"Boss",
				"boss@team.org",
				0,
				null,
				staleAdminTimestamp,
				staleAdminTimestamp,
				"admin",
				"boss",
			);
			first.close();

			// Second startup on the same data dir: idempotent allowlist, promotes the
			// existing student, and leaves the existing admin row untouched.
			const second = await createApp(baseOptions);
			try {
				const afterSecond = JSON.parse(
					await readFile(allowlistPath, "utf8"),
				) as { emails: string[] };
				expect(afterSecond.emails).toEqual(["boss@team.org", "coach@team.org"]);

				const coach = second.storage.db
					.query("SELECT role, updatedAt FROM user WHERE id = ?")
					.get("userCoachAAAAAAAAAAA") as { role: string; updatedAt: string };
				expect(coach.role).toBe("admin");
				expect(coach.updatedAt).not.toBe(staleAdminTimestamp);

				const boss = second.storage.db
					.query("SELECT role, updatedAt FROM user WHERE email = ?")
					.get("boss@team.org") as { role: string; updatedAt: string };
				expect(boss.role).toBe("admin");
				// The already-admin row is not rewritten.
				expect(boss.updatedAt).toBe(staleAdminTimestamp);
			} finally {
				second.close();
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("auth provider discovery", () => {
	test("lists only configured OAuth providers", async () => {
		await withApp(
			async (app) => {
				const response = await app.fetch(
					new Request("http://localhost/api/auth/providers"),
				);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({ providers: ["github"] });
			},
			{
				githubClientId: "github-client-id",
				githubClientSecret: "github-client-secret",
				googleClientId: "",
				googleClientSecret: "",
			},
		);
	});

	test("returns an empty list when no OAuth providers are configured", async () => {
		await withApp(
			async (app) => {
				const response = await app.fetch(
					new Request("http://localhost/api/auth/providers"),
				);
				expect(response.status).toBe(200);
				expect(await response.json()).toEqual({ providers: [] });
			},
			{
				githubClientId: "",
				githubClientSecret: "",
				googleClientId: "",
				googleClientSecret: "",
			},
		);
	});
});

describe("launcher authorization handoff", () => {
	test("exchanges a PKCE code once and rejects a wrong verifier", async () => {
		await withApp(
			async (app) => {
				const loginResponse = await login(app, "alice");
				const cookie = cookieFrom(loginResponse);
				const user = app.storage.db
					.query("SELECT id FROM user WHERE email = ?")
					.get("alice@test.local") as { id: string };
				const now = new Date().toISOString();
				app.storage.db
					.query(
						"INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt) VALUES (?, ?, 'github', ?, ?, ?)",
					)
					.run(
						randomBytes(16).toString("hex"),
						"alice-github",
						user.id,
						now,
						now,
					);
				const codeVerifier = randomBytes(32).toString("base64url");
				const codeChallenge = createHash("sha256")
					.update(codeVerifier)
					.digest("base64url");
				const state = randomBytes(32).toString("base64url");
				const authorizeUrl = new URL("http://localhost/launcher/authorize");
				authorizeUrl.searchParams.set(
					"redirect_uri",
					"http://127.0.0.1:49152/callback",
				);
				authorizeUrl.searchParams.set("state", state);
				authorizeUrl.searchParams.set("code_challenge", codeChallenge);

				const authorize = await app.fetch(
					new Request(authorizeUrl, { headers: { cookie } }),
				);
				expect(authorize.status).toBe(303);
				const callback = new URL(authorize.headers.get("location") ?? "");
				expect(callback.origin).toBe("http://127.0.0.1:49152");
				expect(callback.searchParams.get("state")).toBe(state);
				const code = callback.searchParams.get("code");
				expect(code).toBeTruthy();

				const exchange = (verifier: string) =>
					app.fetch(
						new Request("http://localhost/api/launcher/exchange", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ code, codeVerifier: verifier }),
						}),
					);
				const grantRequestedAt = Date.now();
				expect(
					(await exchange(randomBytes(32).toString("base64url"))).status,
				).toBe(400);
				const exchanged = await exchange(codeVerifier);
				expect(exchanged.status).toBe(200);
				const exchangeBody = (await exchanged.json()) as {
					ok: boolean;
					runtimeTicket: string;
				};
				expect(exchangeBody.ok).toBe(true);
				expect(exchangeBody.runtimeTicket).toHaveLength(43);
				const grantHash = createHash("sha256")
					.update(exchangeBody.runtimeTicket)
					.digest("base64url");
				const grant = app.storage.db
					.query(
						"SELECT expires_at FROM launcher_runtime_grants WHERE token_hash = ?",
					)
					.get(grantHash) as { expires_at: string };
				expect(Date.parse(grant.expires_at)).toBeGreaterThanOrEqual(
					grantRequestedAt + 59_000,
				);
				expect(Date.parse(grant.expires_at)).toBeLessThanOrEqual(
					grantRequestedAt + 61_000,
				);
				const validateTicket = () =>
					app.fetch(
						new Request("http://localhost/api/launcher/validate-launch", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								runtimeTicket: exchangeBody.runtimeTicket,
							}),
						}),
					);
				const validatedTicket = await validateTicket();
				expect(validatedTicket.status).toBe(200);
				const validationBody = (await validatedTicket.json()) as {
					ok: boolean;
					identity: {
						userId: string;
						displayName: string;
						email: string;
						role: string;
					};
				};
				expect(validationBody).toMatchObject({
					ok: true,
					identity: {
						userId: user.id,
						displayName: "alice",
						email: "alice@test.local",
						role: "student",
					},
				});
				expect((await validateTicket()).status).toBe(200);
				const disabledUser = app.storage.db
					.query("SELECT id FROM user WHERE email = ?")
					.get("alice@test.local") as { id: string };
				app.storage.db
					.query("UPDATE user SET disabledAt = ? WHERE id = ?")
					.run(new Date().toISOString(), disabledUser.id);
				expect((await validateTicket()).status).toBe(401);
				expect((await exchange(codeVerifier)).status).toBe(400);
			},
			{
				githubClientId: "client-id",
				githubClientSecret: "client-secret",
				desktopLaunchGrantTtlMs: 60_000,
			},
		);
	});

	test("rejects non-loopback callback targets", async () => {
		await withApp(
			async (app) => {
				const loginResponse = await login(app, "alice");
				const cookie = cookieFrom(loginResponse);
				const authorizeUrl = new URL("http://localhost/launcher/authorize");
				authorizeUrl.searchParams.set(
					"redirect_uri",
					"https://example.com/callback",
				);
				authorizeUrl.searchParams.set(
					"state",
					randomBytes(32).toString("base64url"),
				);
				authorizeUrl.searchParams.set(
					"code_challenge",
					createHash("sha256")
						.update(randomBytes(32).toString("base64url"))
						.digest("base64url"),
				);
				const response = await app.fetch(
					new Request(authorizeUrl, { headers: { cookie } }),
				);
				expect(response.status).toBe(400);
			},
			{ githubClientId: "client-id", githubClientSecret: "client-secret" },
		);
	});

	test("expires an unused launcher authorization code", async () => {
		await withApp(
			async (app) => {
				const loginResponse = await login(app, "alice");
				const cookie = cookieFrom(loginResponse);
				const user = app.storage.db
					.query("SELECT id FROM user WHERE email = ?")
					.get("alice@test.local") as { id: string };
				const now = new Date().toISOString();
				app.storage.db
					.query(
						"INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt) VALUES (?, ?, 'github', ?, ?, ?)",
					)
					.run(
						randomBytes(16).toString("hex"),
						"alice-github",
						user.id,
						now,
						now,
					);
				const codeVerifier = randomBytes(32).toString("base64url");
				const codeChallenge = createHash("sha256")
					.update(codeVerifier)
					.digest("base64url");
				const authorizeUrl = new URL("http://localhost/launcher/authorize");
				authorizeUrl.searchParams.set(
					"redirect_uri",
					"http://127.0.0.1:49153/callback",
				);
				authorizeUrl.searchParams.set(
					"state",
					randomBytes(32).toString("base64url"),
				);
				authorizeUrl.searchParams.set("code_challenge", codeChallenge);
				const authorize = await app.fetch(
					new Request(authorizeUrl, { headers: { cookie } }),
				);
				const callback = new URL(authorize.headers.get("location") ?? "");
				const code = callback.searchParams.get("code") ?? "";
				const codeHash = createHash("sha256").update(code).digest("base64url");
				app.storage.db
					.query(
						"UPDATE launcher_auth_codes SET expires_at = ? WHERE code_hash = ?",
					)
					.run(new Date(Date.now() - 1000).toISOString(), codeHash);

				const exchange = await app.fetch(
					new Request("http://localhost/api/launcher/exchange", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ code, codeVerifier }),
					}),
				);
				expect(exchange.status).toBe(400);
			},
			{ githubClientId: "client-id", githubClientSecret: "client-secret" },
		);
	});

	test("requires a GitHub-linked account for launcher authorization", async () => {
		await withApp(
			async (app) => {
				const loginResponse = await login(app, "alice");
				const authorizeUrl = new URL("http://localhost/launcher/authorize");
				authorizeUrl.searchParams.set(
					"redirect_uri",
					"http://127.0.0.1:49152/callback",
				);
				authorizeUrl.searchParams.set(
					"state",
					randomBytes(32).toString("base64url"),
				);
				authorizeUrl.searchParams.set(
					"code_challenge",
					createHash("sha256")
						.update(randomBytes(32).toString("base64url"))
						.digest("base64url"),
				);
				const response = await app.fetch(
					new Request(authorizeUrl, {
						headers: { cookie: cookieFrom(loginResponse) },
					}),
				);
				expect(response.status).toBe(303);
				expect(response.headers.get("location")).toContain("/login?returnTo=");
			},
			{ githubClientId: "client-id", githubClientSecret: "client-secret" },
		);
	});

	test("sends unauthenticated launchers through central login", async () => {
		await withApp(
			async (app) => {
				const authorizeUrl = new URL("http://localhost/launcher/authorize");
				authorizeUrl.searchParams.set(
					"redirect_uri",
					"http://127.0.0.1:49152/callback",
				);
				authorizeUrl.searchParams.set(
					"state",
					randomBytes(32).toString("base64url"),
				);
				authorizeUrl.searchParams.set(
					"code_challenge",
					createHash("sha256")
						.update(randomBytes(32).toString("base64url"))
						.digest("base64url"),
				);
				const response = await app.fetch(new Request(authorizeUrl));
				expect(response.status).toBe(303);
				expect(response.headers.get("location")).toContain("/login?returnTo=");
			},
			{ githubClientId: "client-id", githubClientSecret: "client-secret" },
		);
	});
});
