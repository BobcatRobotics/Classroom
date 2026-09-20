import type { ReactNode } from "react";

// type SimPaneTab = "scope" | "pathplanner";
export type WorkspaceTool = "scope" | "pathplanner" | "bline" | "preview";
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
	{
		id: "preview",
		label: "Preview",
	},
] as const;

/**
 * The sim panes plus Preview. All stay mounted (`keepMounted`) — the hidden
 * iframes hold live state (an AdvantageScope session, PathPlanner's in-memory
 * working copy and save queue, Preview's selected document) that unmounting
 * would discard.
 */
export function SimPanePanels({
	activeTool,
	scope,
	pathplanner,
	bline,
	preview,
}: {
	activeTool: ActiveTool;
	scope: ReactNode;
	pathplanner: ReactNode;
	bline: ReactNode;
	preview: ReactNode;
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

	if (activeTool === "preview") {
		return preview;
	}

	return null;
}
