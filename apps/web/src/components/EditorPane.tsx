import { AlertTriangle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorStatus } from "@/hooks/useEditorReachability";

interface EditorPaneProps {
	editorUrl: string | null;
	editorStatus: EditorStatus;
	errorMessage?: string;
	/** Seconds spent waiting, used to explain an unusually slow first boot. */
	waitingSeconds?: number;
	/** The proxy's explanation of a failed start, when it sent one. */
	errorDetail?: string | null;
	onReady?: () => void;
}

export function EditorPane({
	editorUrl,
	editorStatus,
	errorMessage,
	waitingSeconds = 0,
	errorDetail = null,
	onReady,
}: EditorPaneProps) {
	const [iframeLoaded, setIframeLoaded] = useState(false);
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const readinessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const editorReachable = editorStatus === "reachable";

	useEffect(() => {
		setIframeLoaded(false);
		return () => {
			if (readinessTimerRef.current !== null) {
				clearTimeout(readinessTimerRef.current);
			}
		};
	}, []);

	const handleLoad = useCallback(() => {
		setIframeLoaded(true);

		// The iframe load event only means the web client document arrived. Wait
		// for the VS Code workbench to mount and settle before unlocking the shell.
		const startedAt = Date.now();
		let stableSince: number | null = null;
		const checkWorkbench = () => {
			const document = iframeRef.current?.contentDocument;
			const workbenchMounted = Boolean(
				document?.querySelector(
					".monaco-workbench, [data-fake-vscode-ready='true']",
				),
			);
			if (workbenchMounted && document?.readyState === "complete") {
				stableSince ??= Date.now();
				if (Date.now() - stableSince >= 5_000) {
					onReady?.();
					return;
				}
			} else {
				stableSince = null;
			}

			// Keep checking while the workbench and extension host finish starting.
			if (Date.now() - startedAt < 120_000) {
				readinessTimerRef.current = setTimeout(checkWorkbench, 250);
			}
		};
		checkWorkbench();
	}, [onReady]);

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
					ref={iframeRef}
					title="VS Code Editor"
					data-pane="editor"
					src={editorUrl}
					allow="clipboard-read; clipboard-write"
					className="h-full w-full border-0"
					onLoad={handleLoad}
				/>
			)}
			{showOverlay &&
				(editorStatus === "error" ? (
					// A spinner here would present a dead editor as one still loading.
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card px-6 text-center">
						<AlertTriangle className="size-8 text-destructive" />
						<span className="font-mono text-sm text-muted-foreground">
							{errorDetail ?? errorMessage ?? "The editor failed to start."}
						</span>
					</div>
				) : (
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
								First boot can take a few minutes. Later starts are much faster.
							</span>
						)}
					</div>
				))}
		</div>
	);
}
