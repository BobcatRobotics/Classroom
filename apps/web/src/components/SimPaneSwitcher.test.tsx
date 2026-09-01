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
});
