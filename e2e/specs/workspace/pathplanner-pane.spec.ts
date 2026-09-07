/**
 * The optional sim tools, wired end to end: WorkspacePage + topbar selector +
 * the PathPlanner iframe and its project-swap remount. The component tests
 * cover the switcher in isolation; these cover the assembly.
 *
 * The fake PathPlanner dist (createPathPlannerDist) counts its loads in
 * sessionStorage and exposes the count on <body>, which makes iframe mounts
 * and project-swap reloads observable even when the iframe's `src` is stable.
 */
import type { Page } from "@playwright/test";
import type { AppFixtures } from "../../fixtures/app";
import { expect, test } from "../../fixtures/app";
import { loginAs } from "../../fixtures/auth";
import {
	seedRuntimeRunning,
	seedWorkspaceProject,
} from "../../fixtures/runtime";
import { WorkspacePage } from "../../page-objects/workspace.po";

type Deps = Pick<AppFixtures, "app" | "runtime" | "fakeVscode" | "fakeHalsim">;

/**
 * Log in, seed a non-empty project (so the Switch Project dialog doesn't
 * auto-open over the UI) and a running runtime, then open the workspace.
 */
async function openWorkspace(
	page: Page,
	{ app, runtime, fakeVscode, fakeHalsim }: Deps,
	name: string,
): Promise<WorkspacePage> {
	const { user } = await loginAs(page, app, { name });
	const workspace = app.storage.findWorkspaceBySlug(user.slug as never)!;
	await seedWorkspaceProject(workspace.project_path);
	seedRuntimeRunning({
		runtime,
		workspaceId: workspace.id,
		fakeVscode,
		fakeHalsim,
	});

	const po = new WorkspacePage(page, user.slug);
	await po.goto();
	return po;
}

/** Waits for the fake PathPlanner page and returns how many times it loaded. */
async function pathplannerLoads(po: WorkspacePage): Promise<number> {
	const body = po.pathplannerIframe().locator("body");
	await expect(body).toHaveAttribute("data-fake-pathplanner-ready", "true");
	await expect(body).toHaveAttribute("data-fake-pathplanner-loads", /^[0-9]+$/);
	return Number(await body.getAttribute("data-fake-pathplanner-loads"));
}

function toolsMenu(page: Page) {
	return page.getByRole("button", { name: /Tools/ });
}

async function selectPathPlanner(page: Page) {
	await toolsMenu(page).click();
	await page.getByRole("menuitem", { name: "PathPlanner" }).click();
}

test("no simulation tool is mounted until one is selected", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	const po = await openWorkspace(
		page,
		{ app, runtime, fakeVscode, fakeHalsim },
		"Planner Default",
	);

	await expect(po.scopeIframe().locator("body")).not.toBeAttached();
	await expect(po.pathplannerFrameElement()).not.toBeAttached();
});

test("selecting PathPlanner loads it, and closing it unmounts it", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	const po = await openWorkspace(
		page,
		{ app, runtime, fakeVscode, fakeHalsim },
		"Planner Switch",
	);

	await selectPathPlanner(page);
	await expect(po.pathplannerFrameElement()).toBeVisible();
	await expect(po.pathplannerIframe().locator("body")).toContainText(
		"PathPlanner test dist",
	);
	const loadsBefore = await pathplannerLoads(po);

	await toolsMenu(page).click();
	await page.getByRole("menuitem", { name: "Close tool(s)" }).click();
	await expect(po.pathplannerFrameElement()).not.toBeVisible();

	await selectPathPlanner(page);
	await expect(po.pathplannerFrameElement()).toBeVisible();
	// Closing the optional tool unmounts it, so selecting it again creates a new
	// iframe document.
	expect(await pathplannerLoads(po)).toBeGreaterThan(loadsBefore);
});

test("PathPlanner is loaded only after selecting it from the Tools menu", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	const po = await openWorkspace(
		page,
		{ app, runtime, fakeVscode, fakeHalsim },
		"Planner Reload",
	);

	await selectPathPlanner(page);
	await expect(po.pathplannerFrameElement()).toBeVisible();

	await page.reload();

	// Tool selection is local UI state, so a reload closes the optional pane.
	await expect(po.pathplannerFrameElement()).not.toBeAttached();
});

test("a project swap reloads the PathPlanner iframe", async ({
	page,
	app,
	runtime,
	fakeVscode,
	fakeHalsim,
}) => {
	const po = await openWorkspace(
		page,
		{ app, runtime, fakeVscode, fakeHalsim },
		"Planner Swap",
	);
	await selectPathPlanner(page);
	const loadsBefore = await pathplannerLoads(po);

	await page.getByRole("button", { name: "Switch project" }).click();
	const dialog = page.getByRole("dialog");

	// The bundled-catalog fixture offers a console module and a robot module;
	// pick the robot one, since console modules hide the sim panes entirely.
	await expect(
		dialog.getByRole("heading", { name: "Robot Starter" }),
	).toBeVisible();
	// The card is the innermost element holding both the module heading and a
	// Load button. `has:` locators must be page-rooted to be re-anchored.
	const robotCard = dialog
		.locator("div")
		.filter({ has: page.getByRole("heading", { name: "Robot Starter" }) })
		.filter({ has: page.getByRole("button", { name: "Load" }) })
		.last();

	await robotCard.getByRole("button", { name: "Load" }).click();
	await dialog.getByRole("button", { name: "Continue" }).click();
	await expect(dialog.getByText("Project ready")).toBeVisible({
		timeout: 15_000,
	});
	await dialog.getByRole("button", { name: "Done" }).click();

	// The remount keeps the same `src`, so assert on the load counter instead.
	await expect
		.poll(() => pathplannerLoads(po), { timeout: 15_000 })
		.toBeGreaterThan(loadsBefore);
});
