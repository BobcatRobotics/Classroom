/**
 * Preview in a `plain-java` console lesson.
 *
 * These lessons have no simulation, so they hide the whole right pane and the
 * Driver Station. Their instructions and test reports are still worth reading,
 * so Preview gets a show/hide button in the topbar's selector slot — and
 * revealing it must not drag any simulation chrome back in with it.
 */
import type { ControlApp } from "../../../apps/control/src/app";
import { expect, test } from "../../fixtures/app";
import { loginAs } from "../../fixtures/auth";
import { seedPreviewProject } from "../../fixtures/preview-project";

function makeConsoleLesson(app: ControlApp, workspaceId: string): void {
	app.storage.db
		.query(
			"UPDATE workspaces SET current_module = ?, current_module_kind = ? WHERE id = ?",
		)
		.run("hello-world", "plain-java", workspaceId);
}

test("a console lesson hides sim chrome and never exposes tools", async ({
	page,
	app,
	baseURL,
}) => {
	const login = await loginAs(page, app, { name: "console" });
	const workspace = app.storage.findWorkspaceBySlug(login.user.slug);
	await seedPreviewProject(workspace?.project_path ?? "");
	makeConsoleLesson(app, workspace?.id ?? "");

	await page.goto(`${baseURL}/u/${login.user.slug}/`);

	await expect(page.locator('[data-pane="console-hint"]')).toBeVisible();
	await expect(page.locator('[data-pane="console"]')).not.toBeVisible();
	await expect(page.locator('[data-pane="preview"]')).not.toBeVisible();
	await expect(page.getByRole("button", { name: "Tools" })).toHaveCount(0);
});
