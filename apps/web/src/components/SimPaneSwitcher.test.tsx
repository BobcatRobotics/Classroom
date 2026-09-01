import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { SimPaneSwitcher } from "./SimPaneSwitcher";

describe("SimPaneSwitcher", () => {
	afterEach(() => {
		sessionStorage.clear();
	});

	test("defaults to the AdvantageScope tab with both panes mounted", () => {
		render(
			<SimPaneSwitcher
				scope={<div>scope-pane</div>}
				pathplanner={<div>pathplanner-pane</div>}
			/>,
		);

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
		render(
			<SimPaneSwitcher
				scope={<div>scope-pane</div>}
				pathplanner={<div>pathplanner-pane</div>}
			/>,
		);

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
		render(
			<SimPaneSwitcher
				scope={<div>scope-pane</div>}
				pathplanner={<div>pathplanner-pane</div>}
			/>,
		);
		expect(screen.getByRole("tab", { name: "PathPlanner" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	test("wires each tab to its panel via aria-controls/aria-labelledby", () => {
		render(
			<SimPaneSwitcher
				scope={<div>scope-pane</div>}
				pathplanner={<div>pathplanner-pane</div>}
			/>,
		);

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

	test("ArrowRight from AdvantageScope selects and focuses PathPlanner", () => {
		render(
			<SimPaneSwitcher
				scope={<div>scope-pane</div>}
				pathplanner={<div>pathplanner-pane</div>}
			/>,
		);

		const scopeTab = screen.getByRole("tab", { name: "AdvantageScope" });
		const pathplannerTab = screen.getByRole("tab", { name: "PathPlanner" });

		expect(scopeTab).toHaveAttribute("tabindex", "0");
		expect(pathplannerTab).toHaveAttribute("tabindex", "-1");

		fireEvent.keyDown(scopeTab.parentElement as HTMLElement, {
			key: "ArrowRight",
		});

		expect(pathplannerTab).toHaveAttribute("aria-selected", "true");
		expect(pathplannerTab).toHaveAttribute("tabindex", "0");
		expect(scopeTab).toHaveAttribute("tabindex", "-1");
		expect(pathplannerTab).toHaveFocus();
	});
});
