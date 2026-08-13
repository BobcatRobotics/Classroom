import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { EditorStatus } from "@/hooks/useEditorReachability";

interface EditorPaneProps {
	editorUrl: string | null;
	editorStatus: EditorStatus;
	errorMessage?: string;
	/** Seconds spent waiting, used to explain an unusually slow first boot. */
	waitingSeconds?: number;
}

export function EditorPane({
	editorUrl,
	editorStatus,
	errorMessage,
	waitingSeconds = 0,
}: EditorPaneProps) {
	const [iframeLoaded, setIframeLoaded] = useState(false);
	const editorReachable = editorStatus === "reachable";

	useEffect(() => {
		setIframeLoaded(false);
	}, []);

	const handleLoad = useCallback(() => setIframeLoaded(true), []);

	if (!editorUrl) {
		return (
			<div className="flex h-full w-full items-center justify-center bg-card font-mono text-sm text-muted-foreground">
				{errorMessage ?? "Loading editor..."}
			</div>
		);
	}

	const showOverlay = !editorReachable || !iframeLoaded;

	return (
		<div className="relative h-full w-full">
			{editorReachable && (
				<iframe
					title="VS Code Editor"
					data-pane="editor"
					src={editorUrl}
					allow="clipboard-read; clipboard-write"
					className="h-full w-full border-0"
					onLoad={handleLoad}
				/>
			)}
			{showOverlay && (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card px-6 text-center">
					<Loader2 className="size-8 animate-spin text-muted-foreground" />
					<span className="font-mono text-sm text-muted-foreground">
						{editorStatus === "starting"
							? "Starting the editor…"
							: "Loading VS Code…"}
					</span>
					{/* Without this, a slow first boot just looks hung. */}
					{editorStatus === "starting" && waitingSeconds >= 20 && (
						<span className="max-w-md text-xs text-muted-foreground">
							First boot can take a few minutes.
							Later starts are much faster.
						</span>
					)}
				</div>
			)}
		</div>
	);
}
