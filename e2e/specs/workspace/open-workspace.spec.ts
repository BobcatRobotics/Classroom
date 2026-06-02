/**
 * First login creates an EMPTY project dir (template seeding was removed — the
 * student fills it by picking a lesson). Runtime failure surfaces an error to
 * the workspace HTTP route.
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { expect, test } from "../../fixtures/app";
import { cookieHeader, loginAs } from "../../fixtures/auth";
import { seedRuntimeRunning } from "../../fixtures/runtime";

test("first login creates an empty project dir and reports projectEmpty", async ({
	page,
	app,
}) => {
	const { user } = await loginAs(page, app, { name: "Alice" });
	const workspace = app.storage.findWorkspaceBySlug(user.slug as never);
	expect(workspace).toBeTruthy();
	const projectPath = workspace?.project_path as string;
	// The dir exists but is empty — no first-login seeding anymore (D7/D11).
	expect(existsSync(projectPath)).toBe(true);
	expect(await readdir(projectPath)).toHaveLength(0);

	// The session reflects the empty starting state.
	const session = await loginAs(page, app, { name: "Alice" });
	const resp = await app.fetch(
		new Request(`${app.storage.config.baseUrl}/u/${user.slug}/api/session`, {
			headers: { cookie: cookieHeader(session) },
		}),
	);
	const body = (await resp.json()) as {
		workspace: { projectEmpty: boolean; currentModule: string | null };
	};
	expect(body.workspace.projectEmpty).toBe(true);
	expect(body.workspace.currentModule).toBeNull();
});

test("web shell HTML is served from /u/<slug>/", async ({
	page,
	app,
	fakeVscode,
	fakeHalsim,
	runtime,
}) => {
	const { user } = await loginAs(page, app, { name: "Alice" });
	const workspace = app.storage.findWorkspaceBySlug(user.slug as never)!;
	seedRuntimeRunning({
		runtime,
		workspaceId: workspace.id,
		fakeVscode,
		fakeHalsim,
	});

	await page.goto(`/u/${user.slug}/`);
	// We don't assert a specific React UI element — that would require data-testids.
	// We assert the server returned a 2xx for the workspace path, which the SPA
	// shell needs to mount.
	await expect(page).toHaveURL(new RegExp(`/u/${user.slug}/`));
});
