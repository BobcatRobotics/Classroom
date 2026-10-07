import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ProjectMenu } from "./ProjectMenu";

describe("ProjectMenu completion action", () => {
	test("is disabled until completion eligibility is confirmed", () => {
		render(
			<ProjectMenu
				onSwitchProject={() => {}}
				completion={{
					eligible: false,
					completed: false,
					loading: false,
					marking: false,
					message: "Start the robot and pass all tests.",
					onMark: () => {},
				}}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /projects/i }));
		const markItem = screen.getByRole("menuitem", {
			name: "Mark lesson completed",
		});
		expect(markItem.getAttribute("aria-disabled")).toBe("true");
	});

	test("shows the completed state and keeps it disabled", () => {
		render(
			<ProjectMenu
				onSwitchProject={() => {}}
				completion={{
					eligible: true,
					completed: true,
					loading: false,
					marking: false,
					message: "Lesson marked complete.",
					onMark: () => {},
				}}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /projects/i }));
		const markItem = screen.getByRole("menuitem", {
			name: "Lesson marked completed",
		});
		expect(markItem.getAttribute("aria-disabled")).toBe("true");
	});
});
