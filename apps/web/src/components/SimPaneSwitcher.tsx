import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useRef, useState } from "react";

type SimPaneTab = "scope" | "pathplanner";

const STORAGE_KEY = "coderunner:sim-pane-tab";

const TAB_IDS: Record<SimPaneTab, string> = {
	scope: "sim-pane-tab-scope",
	pathplanner: "sim-pane-tab-pathplanner",
};

const PANEL_IDS: Record<SimPaneTab, string> = {
	scope: "sim-pane-panel-scope",
	pathplanner: "sim-pane-panel-pathplanner",
};

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
 * Implements the WAI-ARIA tabs pattern (tab/tabpanel association, roving
 * tabindex, Left/Right arrow navigation) for the two fixed tabs.
 *
 * NOTE: not yet mounted anywhere — see TODO(pathplanner) in WorkspacePage.
 */
export function SimPaneSwitcher({ scope, pathplanner }: SimPaneSwitcherProps) {
	const [active, setActive] = useState<SimPaneTab>(readStoredTab);
	const tabRefs = useRef<Record<SimPaneTab, HTMLButtonElement | null>>({
		scope: null,
		pathplanner: null,
	});

	const select = useCallback((tab: SimPaneTab) => {
		setActive(tab);
		try {
			sessionStorage.setItem(STORAGE_KEY, tab);
		} catch {
			// Session storage unavailable (private mode); the toggle still works.
		}
	}, []);

	const selectAndFocus = useCallback(
		(tab: SimPaneTab) => {
			select(tab);
			tabRefs.current[tab]?.focus();
		},
		[select],
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
				event.preventDefault();
				selectAndFocus(active === "scope" ? "pathplanner" : "scope");
			}
		},
		[active, selectAndFocus],
	);

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
				onKeyDown={handleKeyDown}
			>
				<button
					ref={(el) => {
						tabRefs.current.scope = el;
					}}
					id={TAB_IDS.scope}
					type="button"
					role="tab"
					aria-selected={active === "scope"}
					aria-controls={PANEL_IDS.scope}
					tabIndex={active === "scope" ? 0 : -1}
					className={tabClass(active === "scope")}
					onClick={() => select("scope")}
				>
					AdvantageScope
				</button>
				<button
					ref={(el) => {
						tabRefs.current.pathplanner = el;
					}}
					id={TAB_IDS.pathplanner}
					type="button"
					role="tab"
					aria-selected={active === "pathplanner"}
					aria-controls={PANEL_IDS.pathplanner}
					tabIndex={active === "pathplanner" ? 0 : -1}
					className={tabClass(active === "pathplanner")}
					onClick={() => select("pathplanner")}
				>
					PathPlanner
				</button>
			</div>
			<div
				id={PANEL_IDS.scope}
				role="tabpanel"
				aria-labelledby={TAB_IDS.scope}
				className="min-h-0 flex-1"
				hidden={active !== "scope"}
			>
				{scope}
			</div>
			<div
				id={PANEL_IDS.pathplanner}
				role="tabpanel"
				aria-labelledby={TAB_IDS.pathplanner}
				className="min-h-0 flex-1"
				hidden={active !== "pathplanner"}
			>
				{pathplanner}
			</div>
		</div>
	);
}
