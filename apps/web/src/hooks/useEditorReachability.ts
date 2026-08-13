import { EDITOR_STATE_HEADER } from "@frc-coderunner/contracts";
import { useEffect, useState } from "react";

export type EditorStatus = "loading" | "starting" | "reachable" | "error";

export interface EditorReachability {
	status: EditorStatus;
	/** Seconds spent waiting for the editor, for progressive "still going" copy. */
	waitingSeconds: number;
}

export function useEditorReachability(
	editorUrl: string | null,
): EditorReachability {
	const [status, setStatus] = useState<EditorStatus>("loading");
	const [waitingSeconds, setWaitingSeconds] = useState(0);

	useEffect(() => {
		if (!editorUrl) return;

		let cancelled = false;
		const startedAt = Date.now();
		setWaitingSeconds(0);

		const probeEditor = async () => {
			try {
				const response = await fetch(editorUrl, {
					credentials: "same-origin",
					method: "GET",
				});
				if (cancelled) return;
				if (response.status < 500) {
					setStatus("reachable");
					return;
				}
				// The proxy marks "still booting" so a slow first boot does not
				// present as a failure.
				setStatus(
					response.headers.get(EDITOR_STATE_HEADER) === "starting"
						? "starting"
						: "error",
				);
			} catch {
				if (!cancelled) setStatus("error");
			}
		};

		void probeEditor();
		const interval = window.setInterval(() => {
			setWaitingSeconds(Math.floor((Date.now() - startedAt) / 1000));
			void probeEditor();
		}, 10_000);
		return () => {
			cancelled = true;
			window.clearInterval(interval);
		};
	}, [editorUrl]);

	return { status, waitingSeconds };
}
