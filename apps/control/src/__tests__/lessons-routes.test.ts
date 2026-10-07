import { describe, expect, test } from "bun:test";
import type { LessonModule } from "@frc-coderunner/contracts";
import { cookieFrom, createFakeDocker, login, withApp } from "./helpers";

describe("GET /u/:slug/api/lessons", () => {
	test("returns the bundled manifest sorted by order", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const resp = await login(app, "alice");
				const cookie = cookieFrom(resp);

				const lessons = await app.fetch(
					new Request("http://localhost/u/alice/api/lessons", {
						headers: { cookie },
					}),
				);
				expect(lessons.status).toBe(200);
				const body = (await lessons.json()) as {
					ok: boolean;
					modules: LessonModule[];
					error: string | null;
				};
				expect(body.ok).toBe(true);
				expect(body.error).toBeNull();
				expect(body.modules.map((m) => m.id)).toEqual([
					"hello-world",
					"robot-starter",
				]);
				expect(body.modules[0]?.kind).toBe("plain-java");
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("requires workspace ownership", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				await login(app, "alice");
				const bob = await login(app, "bob");
				const bobCookie = cookieFrom(bob);
				const resp = await app.fetch(
					new Request("http://localhost/u/alice/api/lessons", {
						headers: { cookie: bobCookie },
					}),
				);
				expect(resp.status).toBe(403);
			},
			{ dockerRunner: docker.runner },
		);
	});
});

describe("POST /u/:slug/api/lessons/load", () => {
	test("resolves a known module and 404s an unknown one", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const resp = await login(app, "alice");
				const cookie = cookieFrom(resp);

				const ok = await app.fetch(
					new Request("http://localhost/u/alice/api/lessons/load", {
						method: "POST",
						headers: { cookie, "content-type": "application/json" },
						body: JSON.stringify({ moduleId: "hello-world" }),
					}),
				);
				expect(ok.status).toBe(200);
				expect(await ok.json()).toEqual({ ok: true });

				const unknown = await app.fetch(
					new Request("http://localhost/u/alice/api/lessons/load", {
						method: "POST",
						headers: { cookie, "content-type": "application/json" },
						body: JSON.stringify({ moduleId: "does-not-exist" }),
					}),
				);
				expect(unknown.status).toBe(404);

				const bad = await app.fetch(
					new Request("http://localhost/u/alice/api/lessons/load", {
						method: "POST",
						headers: { cookie, "content-type": "application/json" },
						body: JSON.stringify({ moduleId: "" }),
					}),
				);
				expect(bad.status).toBe(400);
			},
			{ dockerRunner: docker.runner },
		);
	});
});

describe("/api/session reflects the loaded module", () => {
	test("currentModule + projectEmpty update after a bundled lesson load", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const resp = await login(app, "alice");
				const cookie = cookieFrom(resp);

				// Fresh workspace: empty, no module.
				const before = (await (
					await app.fetch(
						new Request("http://localhost/u/alice/api/session", {
							headers: { cookie },
						}),
					)
				).json()) as {
					workspace: {
						currentModule: string | null;
						currentModuleKind: string | null;
						projectEmpty: boolean;
					};
				};
				expect(before.workspace.currentModule).toBeNull();
				expect(before.workspace.projectEmpty).toBe(true);

				// Simulate a completed lesson load by recording the module + writing a
				// file into the host project dir (the real load streams over WS).
				const workspace = app.storage.db
					.query("SELECT * FROM workspaces WHERE slug = ?")
					.get("alice") as { id: string; project_path: string };
				app.storage.setCurrentModule(
					workspace.id as never,
					"hello-world",
					"plain-java",
				);
				const { writeFile } = await import("node:fs/promises");
				await writeFile(
					`${workspace.project_path}/README.md`,
					"# hi\n",
					"utf8",
				);

				const after = (await (
					await app.fetch(
						new Request("http://localhost/u/alice/api/session", {
							headers: { cookie },
						}),
					)
				).json()) as {
					workspace: {
						currentModule: string | null;
						currentModuleKind: string | null;
						projectEmpty: boolean;
					};
				};
				expect(after.workspace.currentModule).toBe("hello-world");
				expect(after.workspace.currentModuleKind).toBe("plain-java");
				expect(after.workspace.projectEmpty).toBe(false);
			},
			{ dockerRunner: docker.runner },
		);
	});
});

describe("GET /u/:slug/api/completion/status", () => {
	test("requires a started robot run and the latest run to pass every test", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const loginResponse = await login(app, "alice");
				const cookie = cookieFrom(loginResponse);
				const workspace = app.storage.db
					.query("SELECT id FROM workspaces WHERE slug = ?")
					.get("alice") as { id: string };
				app.storage.setCurrentModule(
					workspace.id as never,
					"robot-starter",
					"robot",
				);

				const getStatus = async () => {
					const response = await app.fetch(
						new Request("http://localhost/u/alice/api/completion/status", {
							headers: { cookie },
						}),
					);
					expect(response.status).toBe(200);
					return (await response.json()) as { eligible: boolean };
				};

				expect(await getStatus()).toMatchObject({ eligible: false });

				const run = app.storage.createRunJob({
					workspaceId: workspace.id as never,
					moduleId: "robot-starter",
					logPath: "/tmp/robot-starter.log",
				});
				app.storage.updateRunJob({
					id: run.id,
					state: "running",
					started: true,
				});
				app.storage.setRunTestResults(run.id, {
					total: 2,
					passed: 2,
					failed: 0,
					skipped: 0,
				});
				expect(await getStatus()).toMatchObject({ eligible: true });

				const laterRun = app.storage.createRunJob({
					workspaceId: workspace.id as never,
					moduleId: "robot-starter",
					logPath: "/tmp/robot-starter-later.log",
				});
				app.storage.updateRunJob({
					id: laterRun.id,
					state: "running",
					started: true,
				});
				app.storage.setRunTestResults(laterRun.id, {
					total: 2,
					passed: 1,
					failed: 1,
					skipped: 0,
				});
				expect(await getStatus()).toMatchObject({ eligible: false });
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("records each eligible mark as a separate completion", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const loginResponse = await login(app, "alice");
				const cookie = cookieFrom(loginResponse);
				const workspace = app.storage.db
					.query("SELECT id FROM workspaces WHERE slug = ?")
					.get("alice") as { id: string };
				app.storage.config.centralRuntimeTicket = "a".repeat(43);
				app.storage.setCurrentModule(
					workspace.id as never,
					"robot-starter",
					"robot",
				);
				const run = app.storage.createRunJob({
					workspaceId: workspace.id as never,
					moduleId: "robot-starter",
					logPath: "/tmp/robot-starter.log",
				});
				app.storage.updateRunJob({
					id: run.id,
					state: "running",
					started: true,
				});
				app.storage.setRunTestResults(run.id, {
					total: 1,
					passed: 1,
					failed: 0,
					skipped: 0,
				});

				const mark = () =>
					app.fetch(
						new Request("http://localhost/u/alice/api/completion/mark", {
							method: "POST",
							headers: { cookie },
						}),
					);
				const first = await mark();
				const firstBody = (await first.json()) as {
					completion: { id: string; completedAt: string };
				};
				const second = await mark();
				const secondBody = (await second.json()) as {
					completion: { id: string; completedAt: string };
				};
				expect(first.status).toBe(200);
				expect(second.status).toBe(200);
				expect(secondBody.completion.id).not.toBe(firstBody.completion.id);
				expect(
					secondBody.completion.completedAt > firstBody.completion.completedAt,
				).toBe(true);
				expect(app.storage.listPendingLessonCompletionSync()).toHaveLength(2);
			},
			{ dockerRunner: docker.runner },
		);
	});
});
