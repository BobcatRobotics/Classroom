import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { IDELayout } from "./IDELayout";

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

describe("IDELayout", () => {
	const originalResizeObserver = globalThis.ResizeObserver;

	beforeEach(() => {
		globalThis.ResizeObserver = FakeResizeObserver as typeof ResizeObserver;
	});

	afterEach(() => {
		globalThis.ResizeObserver = originalResizeObserver;
		sessionStorage.clear();
	});

	test("renders editor, scope, and Driver Station in robot mode", () => {
		render(
			<IDELayout
				editor={<div>Editor</div>}
				scope={<div>Scope</div>}
				driverStation={<div>Driver Station</div>}
			/>,
		);

		expect(screen.getByText("Editor")).toBeInTheDocument();
		expect(screen.getByText("Scope")).toBeInTheDocument();
		expect(screen.getByText("Driver Station")).toBeInTheDocument();
		expect(screen.queryByText(/Run this lesson from the editor/)).toBeNull();
	});

	test("hides simulator panels in console lesson mode", () => {
		render(
			<IDELayout
				showSimPanels={false}
				editor={<div>Editor</div>}
				scope={<div>Scope</div>}
				driverStation={<div>Driver Station</div>}
			/>,
		);

		expect(screen.getByText("Editor")).toBeInTheDocument();
		expect(screen.queryByText("Scope")).toBeNull();
		expect(screen.queryByText("Driver Station")).toBeNull();
		expect(
			screen.getByText(/Run this lesson from the editor/),
		).toBeInTheDocument();
	});

	test("restores persisted pane sizes from sessionStorage", () => {
		sessionStorage.setItem(
			"react-resizable-panels:ide-rows",
			JSON.stringify({ "ide-workbench": 30, "ide-console": 70 }),
		);
		sessionStorage.setItem(
			"react-resizable-panels:ide-columns",
			JSON.stringify({ "ide-editor": 65, "ide-scope": 35 }),
		);

		render(
			<IDELayout
				editor={<div>Editor</div>}
				scope={<div>Scope</div>}
				driverStation={<div>Driver Station</div>}
			/>,
		);

		expect(document.getElementById("ide-workbench")?.style.flexGrow).toBe("30");
		expect(document.getElementById("ide-console")?.style.flexGrow).toBe("70");
		expect(document.getElementById("ide-editor")?.style.flexGrow).toBe("65");
		expect(document.getElementById("ide-scope")?.style.flexGrow).toBe("35");
	});
});
