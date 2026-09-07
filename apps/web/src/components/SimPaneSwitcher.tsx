import type { ReactNode } from "react";

// type SimPaneTab = "scope" | "pathplanner";
export type WorkspaceTool = "scope" | "pathplanner" | "bline";
export type ActiveTool = WorkspaceTool | null;

export const workspaceTools = [
	{
		id: "scope",
		label: "AdvantageScope",
	},
	{
		id: "pathplanner",
		label: "PathPlanner",
	},
	{
		id: "bline",
		label: "BLine",
	},
] as const;

/**
 * The two sim panes. Both stay mounted (`keepMounted`) — the hidden iframes
 * hold live state (an AdvantageScope session, PathPlanner's in-memory working
 * copy and save queue) that unmounting would discard.
 */
export function SimPanePanels({
	activeTool,
	scope,
	pathplanner,
	bline,
}: {
	activeTool: ActiveTool;
	scope: ReactNode;
	pathplanner: ReactNode;
	bline: ReactNode;
}) {
	if (activeTool === "scope") {
		return scope;
	}

	if (activeTool === "pathplanner") {
		return pathplanner;
	}

	if (activeTool === "bline") {
		return bline;
	}

	return null;
}
