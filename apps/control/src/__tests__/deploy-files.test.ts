import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DeployFilesSnapshotResponse } from "@frc-coderunner/contracts";
import {
	cookieFrom,
	createFakeDocker,
	login,
	withApp,
	workspaceProjectPath,
} from "./helpers";

const PP = "src/main/deploy/pathplanner";
const CHOREO = "src/main/deploy/choreo";

async function seedDeployTree(projectPath: string): Promise<void> {
	await mkdir(join(projectPath, PP, "paths"), { recursive: true });
	await mkdir(join(projectPath, CHOREO), { recursive: true });
	await writeFile(
		join(projectPath, PP, "paths", "Example.path"),
		'{"version": "2025.0"}',
		"utf8",
	);
	await writeFile(join(projectPath, PP, "settings.json"), "{}", "utf8");
	await writeFile(join(projectPath, CHOREO, "Traj.traj"), "{}", "utf8");
	// Dotfiles must never leak into the snapshot.
	await writeFile(join(projectPath, PP, ".DS_Store"), "junk", "utf8");
}

describe("GET /u/:slug/api/deploy-files/snapshot", () => {
	test("returns pathplanner and choreo files, skipping dotfiles", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				await seedDeployTree(workspaceProjectPath(app, "alice"));

				const resp = await app.fetch(
					new Request("http://localhost/u/alice/api/deploy-files/snapshot", {
						headers: { cookie },
					}),
				);
				expect(resp.status).toBe(200);
				const body = (await resp.json()) as DeployFilesSnapshotResponse;
				expect(body.ok).toBe(true);
				expect(body.files.map((f) => f.path).sort()).toEqual([
					`${CHOREO}/Traj.traj`,
					`${PP}/paths/Example.path`,
					`${PP}/settings.json`,
				]);
				const example = body.files.find(
					(f) => f.path === `${PP}/paths/Example.path`,
				);
				expect(example?.content).toBe('{"version": "2025.0"}');
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("returns an empty list when no deploy dirs exist", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				const resp = await app.fetch(
					new Request("http://localhost/u/alice/api/deploy-files/snapshot", {
						headers: { cookie },
					}),
				);
				expect(resp.status).toBe(200);
				expect(await resp.json()).toEqual({ ok: true, files: [] });
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("requires workspace ownership", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				await login(app, "alice");
				const bobCookie = cookieFrom(await login(app, "bob"));
				const resp = await app.fetch(
					new Request("http://localhost/u/alice/api/deploy-files/snapshot", {
						headers: { cookie: bobCookie },
					}),
				);
				expect(resp.status).toBe(403);
			},
			{ dockerRunner: docker.runner },
		);
	});
});

describe("PUT /u/:slug/api/deploy-files/:path", () => {
	test("writes a file, creating parent directories", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				const resp = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${PP}/paths/New.path`,
						{
							method: "PUT",
							headers: { cookie, "content-type": "text/plain" },
							body: '{"a": 1}',
						},
					),
				);
				expect(resp.status).toBe(200);
				expect(await resp.json()).toEqual({ ok: true });
				const written = await readFile(
					join(workspaceProjectPath(app, "alice"), PP, "paths", "New.path"),
					"utf8",
				);
				expect(written).toBe('{"a": 1}');
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("handles URL-encoded names with spaces", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				const resp = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${PP}/paths/Two%20Piece.path`,
						{ method: "PUT", headers: { cookie }, body: "{}" },
					),
				);
				expect(resp.status).toBe(200);
				const written = await readFile(
					join(
						workspaceProjectPath(app, "alice"),
						PP,
						"paths",
						"Two Piece.path",
					),
					"utf8",
				);
				expect(written).toBe("{}");
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("rejects writes outside the pathplanner subtree", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				for (const path of [
					`${CHOREO}/Traj.traj`, // choreo is read-only
					"build.gradle",
					"src/main/java/frc/robot/Robot.java",
				]) {
					const resp = await app.fetch(
						new Request(`http://localhost/u/alice/api/deploy-files/${path}`, {
							method: "PUT",
							headers: { cookie },
							body: "x",
						}),
					);
					expect(resp.status).toBe(403);
				}
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("rejects traversal and malformed paths", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				// These reach the handler with their encoding intact and fail the
				// path schema.
				for (const raw of [
					`${PP}/..%2fescape.json`,
					`${PP}/.hidden`,
					"%2fetc%2fpasswd",
				]) {
					const resp = await app.fetch(
						new Request(`http://localhost/u/alice/api/deploy-files/${raw}`, {
							method: "PUT",
							headers: { cookie },
							body: "x",
						}),
					);
					expect(resp.status).toBe(400);
				}

				// The WHATWG URL parser collapses percent-encoded dot segments
				// ("%2e%2e" == "..") during parsing, so this arrives as an
				// already-traversed path OUTSIDE the write root → 403, and nothing
				// is written.
				const collapsed = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${PP}/%2e%2e/escape.json`,
						{ method: "PUT", headers: { cookie }, body: "x" },
					),
				);
				expect(collapsed.status).toBe(403);
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("rejects oversized bodies with 413", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				const resp = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${PP}/big.json`,
						{
							method: "PUT",
							headers: { cookie },
							body: "x".repeat(5 * 1024 * 1024 + 1),
						},
					),
				);
				expect(resp.status).toBe(413);
			},
			{ dockerRunner: docker.runner },
		);
	});
});

describe("DELETE /u/:slug/api/deploy-files/:path", () => {
	test("deletes an existing file and 404s a missing one", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				await seedDeployTree(workspaceProjectPath(app, "alice"));

				const del = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${PP}/paths/Example.path`,
						{ method: "DELETE", headers: { cookie } },
					),
				);
				expect(del.status).toBe(200);

				const again = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${PP}/paths/Example.path`,
						{ method: "DELETE", headers: { cookie } },
					),
				);
				expect(again.status).toBe(404);
			},
			{ dockerRunner: docker.runner },
		);
	});

	test("refuses to delete outside the pathplanner subtree", async () => {
		const docker = createFakeDocker();
		await withApp(
			async (app) => {
				const cookie = cookieFrom(await login(app, "alice"));
				await seedDeployTree(workspaceProjectPath(app, "alice"));
				const resp = await app.fetch(
					new Request(
						`http://localhost/u/alice/api/deploy-files/${CHOREO}/Traj.traj`,
						{ method: "DELETE", headers: { cookie } },
					),
				);
				expect(resp.status).toBe(403);
			},
			{ dockerRunner: docker.runner },
		);
	});
});
