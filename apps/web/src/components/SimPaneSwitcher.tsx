import type { ReactNode } from "react";
import { useCallback, useState } from "react";

type SimPaneTab = "scope" | "pathplanner";

const STORAGE_KEY = "coderunner:sim-pane-tab";

function readStoredTab(): SimPaneTab {
	try {
		return sessionStorage.getItem(STORAGE_KEY) === "pathplanner"
			? "pathplanner"
			: "scope";
	} catch {
		return "scope";
	}
}

interface SimPaneSwitcherProps {
	scope: ReactNode;
	pathplanner: ReactNode;
}

/**
 * Tab toggle for the right-hand sim pane: AdvantageScope or PathPlanner.
 * Both children stay mounted — the hidden PathPlanner iframe holds an
 * in-memory working copy and a save queue that unmounting would discard.
 *
 * NOTE: not yet mounted anywhere — see TODO(pathplanner) in WorkspacePage.
 */
export function SimPaneSwitcher({ scope, pathplanner }: SimPaneSwitcherProps) {
	const [active, setActive] = useState<SimPaneTab>(readStoredTab);

	const select = useCallback((tab: SimPaneTab) => {
		setActive(tab);
		try {
			sessionStorage.setItem(STORAGE_KEY, tab);
		} catch {
			// Session storage unavailable (private mode); the toggle still works.
		}
	}, []);

	const tabClass = (selected: boolean) =>
		`px-3 py-1.5 text-[12px] font-medium border-b-2 ${
			selected
				? "border-primary text-foreground"
				: "border-transparent text-muted-foreground hover:text-foreground"
		}`;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				role="tablist"
				aria-label="Simulation pane"
				className="flex shrink-0 border-b border-border bg-card"
			>
				<button
					type="button"
					role="tab"
					aria-selected={active === "scope"}
					className={tabClass(active === "scope")}
					onClick={() => select("scope")}
				>
					AdvantageScope
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={active === "pathplanner"}
					className={tabClass(active === "pathplanner")}
					onClick={() => select("pathplanner")}
				>
					PathPlanner
				</button>
			</div>
			<div className="min-h-0 flex-1" hidden={active !== "scope"}>
				{scope}
			</div>
			<div className="min-h-0 flex-1" hidden={active !== "pathplanner"}>
				{pathplanner}
			</div>
		</div>
	);
}
