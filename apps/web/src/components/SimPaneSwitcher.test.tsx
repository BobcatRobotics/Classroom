import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";
import {
	SimPanePanels,
	SimPaneTabSelector,
	SimPaneTabs,
} from "./SimPaneSwitcher";

function renderSwitcher() {
	return render(
		<SimPaneTabs>
			<SimPaneTabSelector />
			<SimPanePanels
				scope={<div>scope-pane</div>}
				pathplanner={<div>pathplanner-pane</div>}
			/>
		</SimPaneTabs>,
	);
}

describe("SimPaneSwitcher", () => {
	afterEach(() => {
		sessionStorage.clear();
	});

	test("defaults to the AdvantageScope tab with both panes mounted", () => {
		renderSwitcher();

		// Both stay mounted so the hidden iframe keeps its state.
		expect(screen.getByText("scope-pane")).toBeInTheDocument();
		expect(screen.getByText("pathplanner-pane")).toBeInTheDocument();

		expect(screen.getByRole("tab", { name: "AdvantageScope" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		expect(screen.getByText("pathplanner-pane").parentElement).toHaveProperty(
			"hidden",
			true,
		);
	});

	test("switches tabs and persists the choice", () => {
		renderSwitcher();

		fireEvent.click(screen.getByRole("tab", { name: "PathPlanner" }));

		expect(screen.getByRole("tab", { name: "PathPlanner" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		expect(screen.getByText("scope-pane").parentElement).toHaveProperty(
			"hidden",
			true,
		);
		expect(screen.getByText("pathplanner-pane").parentElement).toHaveProperty(
			"hidden",
			false,
		);
		expect(sessionStorage.getItem("coderunner:sim-pane-tab")).toBe(
			"pathplanner",
		);
	});

	test("restores the persisted tab", () => {
		sessionStorage.setItem("coderunner:sim-pane-tab", "pathplanner");
		renderSwitcher();

		expect(screen.getByRole("tab", { name: "PathPlanner" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	test("wires each tab to its panel via aria-controls/aria-labelledby", () => {
		renderSwitcher();

		const scopeTab = screen.getByRole("tab", { name: "AdvantageScope" });
		const pathplannerTab = screen.getByRole("tab", { name: "PathPlanner" });
		const [scopePanel, pathplannerPanel] = screen.getAllByRole("tabpanel", {
			hidden: true,
		});

		expect(scopeTab).toHaveAttribute("aria-controls", scopePanel.id);
		expect(scopePanel).toHaveAttribute("aria-labelledby", scopeTab.id);
		expect(pathplannerTab).toHaveAttribute(
			"aria-controls",
			pathplannerPanel.id,
		);
		expect(pathplannerPanel).toHaveAttribute(
			"aria-labelledby",
			pathplannerTab.id,
		);
	});

	test("ArrowRight moves focus and Enter activates PathPlanner", async () => {
		renderSwitcher();

		const scopeTab = screen.getByRole("tab", { name: "AdvantageScope" });
		const pathplannerTab = screen.getByRole("tab", { name: "PathPlanner" });

		expect(scopeTab).toHaveAttribute("tabindex", "0");
		expect(pathplannerTab).toHaveAttribute("tabindex", "-1");

		const user = userEvent.setup();
		scopeTab.focus();
		await user.keyboard("{ArrowRight}");

		// Manual activation: arrowing only moves focus, so a keyboard user can
		// pass over PathPlanner without swapping the pane's iframe.
		await waitFor(() => expect(pathplannerTab).toHaveFocus());
		expect(scopeTab).toHaveAttribute("aria-selected", "true");

		await user.keyboard("{Enter}");

		expect(pathplannerTab).toHaveAttribute("aria-selected", "true");
		expect(scopeTab).toHaveAttribute("aria-selected", "false");
	});
});
