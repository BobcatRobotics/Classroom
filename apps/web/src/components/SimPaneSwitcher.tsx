import type { TabsTab } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import {
	Tabs,
	TabsContent,
	TabsIndicator,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";

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

interface SimPaneTabsProps {
	className?: string;
	children: ReactNode;
}

/**
 * Tabs root for the right-hand sim pane: AdvantageScope (default) or
 * PathPlanner. The selector lives in the topbar and the panels live in the
 * sim pane, so the root has to wrap both — hence a page-level provider.
 * The choice persists for the session.
 */
export function SimPaneTabs({ className, children }: SimPaneTabsProps) {
	const [tab, setTab] = useState<SimPaneTab>(readStoredTab);

	const onValueChange = useCallback((value: TabsTab.Value) => {
		const next: SimPaneTab = value === "pathplanner" ? "pathplanner" : "scope";
		setTab(next);
		try {
			sessionStorage.setItem(STORAGE_KEY, next);
		} catch {
			// Session storage unavailable (private mode); the toggle still works.
		}
	}, []);

	return (
		<Tabs value={tab} onValueChange={onValueChange} className={className}>
			{children}
		</Tabs>
	);
}

/** Pill toggle rendered in the topbar. Must sit inside `SimPaneTabs`. */
export function SimPaneTabSelector() {
	return (
		<TabsList aria-label="Simulation pane" variant="pill" className="p-[3px]">
			<TabsIndicator />
			<TabsTrigger value="scope" className="px-3 text-[12.5px]">
				AdvantageScope
			</TabsTrigger>
			<TabsTrigger value="pathplanner" className="px-3 text-[12.5px]">
				PathPlanner
			</TabsTrigger>
		</TabsList>
	);
}

interface SimPanePanelsProps {
	scope: ReactNode;
	pathplanner: ReactNode;
}

/**
 * The two sim panes. Both stay mounted (`keepMounted`) — the hidden iframes
 * hold live state (an AdvantageScope session, PathPlanner's in-memory working
 * copy and save queue) that unmounting would discard.
 */
export function SimPanePanels({ scope, pathplanner }: SimPanePanelsProps) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<TabsContent value="scope" keepMounted className="min-h-0 flex-1">
				{scope}
			</TabsContent>
			<TabsContent value="pathplanner" keepMounted className="min-h-0 flex-1">
				{pathplanner}
			</TabsContent>
		</div>
	);
}
