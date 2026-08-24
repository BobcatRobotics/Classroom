import { Play } from "lucide-react";
import type { ReactNode } from "react";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
	useResizableLayout,
} from "@/components/ui/resizable";

interface IDELayoutProps {
	editor: ReactNode;
	scope: ReactNode;
	driverStation: ReactNode;
	/**
	 * When false (a `plain-java` console lesson), the AdvantageScope and Driver
	 * Station panels are hidden and the editor fills the workspace, with a hint
	 * to run from the editor's Run button.
	 */
	showSimPanels?: boolean;
}

export function IDELayout({
	editor,
	scope,
	driverStation,
	showSimPanels = true,
}: IDELayoutProps) {
	// Pane sizes survive a refresh but not a new tab/session.
	const rows = useResizableLayout({
		id: "ide-rows",
		storage: sessionStorage,
	});
	const columns = useResizableLayout({
		id: "ide-columns",
		storage: sessionStorage,
	});

	if (!showSimPanels) {
		return (
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				<div className="min-h-0 min-w-0 flex-1 bg-card">{editor}</div>
				<div
					data-pane="console-hint"
					className="flex shrink-0 items-center gap-2 border-t border-border bg-card px-4 py-2 text-[12px] text-muted-foreground"
				>
					<Play className="size-3.5 text-primary" />
					Run this lesson from the editor's Run button (▷ top-right of the
					file).
				</div>
			</div>
		);
	}

	return (
		<ResizablePanelGroup
			orientation="vertical"
			className="min-h-0 flex-1 overflow-hidden"
			defaultLayout={rows.defaultLayout}
			onLayoutChanged={rows.onLayoutChanged}
		>
			<ResizablePanel
				id="ide-workbench"
				defaultSize={75}
				minSize={20}
				className="min-h-0"
			>
				<ResizablePanelGroup
					orientation="horizontal"
					className="min-h-0"
					defaultLayout={columns.defaultLayout}
					onLayoutChanged={columns.onLayoutChanged}
				>
					<ResizablePanel
						id="ide-editor"
						defaultSize={50}
						minSize={25}
						data-pane="editor"
						className="min-h-0"
					>
						<div className="h-full min-h-0 min-w-0 bg-card">{editor}</div>
					</ResizablePanel>
					<ResizableHandle withHandle data-pane="scope-handle" />
					<ResizablePanel
						id="ide-scope"
						defaultSize={50}
						minSize={25}
						className="hidden min-h-0 min-[901px]:block"
						data-pane="scope"
					>
						{scope}
					</ResizablePanel>
				</ResizablePanelGroup>
			</ResizablePanel>
			<ResizableHandle withHandle />
			<ResizablePanel
				id="ide-console"
				defaultSize={25}
				minSize={5}
				data-pane="console"
				className="min-h-0 overflow-hidden"
			>
				{driverStation}
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
