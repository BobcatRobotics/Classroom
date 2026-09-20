import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SimPanePanels } from "./SimPaneSwitcher";

const panes = {
	scope: <div>scope-pane</div>,
	pathplanner: <div>pathplanner-pane</div>,
	bline: <div>bline-pane</div>,
	preview: <div>preview-pane</div>,
};

function renderPanels(
	activeTool: "scope" | "pathplanner" | "bline" | "preview" | null,
) {
	return render(
		<SimPanePanels
			activeTool={activeTool}
			scope={panes.scope}
			pathplanner={panes.pathplanner}
			bline={panes.bline}
			preview={panes.preview}
		/>,
	);
}

describe("SimPaneSwitcher", () => {
	test("renders the pane for each active tool", () => {
		for (const [activeTool, paneText] of Object.entries({
			scope: "scope-pane",
			pathplanner: "pathplanner-pane",
			bline: "bline-pane",
			preview: "preview-pane",
		})) {
			const { unmount } = renderPanels(
				activeTool as "scope" | "pathplanner" | "bline" | "preview",
			);

			expect(screen.getByText(paneText)).toBeTruthy();
			unmount();
		}
	});

	test("renders no pane when there is no active tool", () => {
		renderPanels(null);

		expect(screen.queryByText("scope-pane")).toBeNull();
		expect(screen.queryByText("pathplanner-pane")).toBeNull();
		expect(screen.queryByText("bline-pane")).toBeNull();
		expect(screen.queryByText("preview-pane")).toBeNull();
	});
});
