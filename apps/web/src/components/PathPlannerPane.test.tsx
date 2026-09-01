import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PathPlannerPane } from "./PathPlannerPane";

describe("PathPlannerPane", () => {
	test("renders the iframe pointed at the workspace's PathPlanner URL", () => {
		render(<PathPlannerPane workspaceSlug="alice" />);
		const frame = screen.getByTitle<HTMLIFrameElement>("PathPlanner");
		expect(frame).toBeInTheDocument();
		expect(frame.getAttribute("src")).toBe("/pathplanner/?ws=alice");
	});

	test("shows the loading overlay until the iframe loads", () => {
		render(<PathPlannerPane workspaceSlug="alice" />);
		expect(screen.getByText(/Loading PathPlanner/)).toBeInTheDocument();

		fireEvent.load(screen.getByTitle("PathPlanner"));
		expect(screen.queryByText(/Loading PathPlanner/)).toBeNull();
	});

	test("renders a calm empty state without a slug, not a stuck spinner", () => {
		render(<PathPlannerPane workspaceSlug={null} />);
		expect(screen.queryByTitle("PathPlanner")).toBeNull();
		expect(screen.queryByText(/Loading PathPlanner/)).toBeNull();
		expect(
			screen.getByText(/PathPlanner is not available for this module/),
		).toBeInTheDocument();
	});
});
