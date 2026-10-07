import { useCallback, useEffect, useRef, useState } from "react";
import {
	type LessonCompletionStatusResponse,
	lessonCompletionResponseSchema,
	lessonCompletionStatusResponseSchema,
	type SimStatusResponse,
} from "@/lib/contracts";

type CompletionState = {
	status: LessonCompletionStatusResponse | null;
	eligible: boolean;
	completed: boolean;
	loading: boolean;
	marking: boolean;
	message: string | null;
	mark: () => Promise<void>;
};

export function useLessonCompletion(
	workspaceSlug: string | null,
	moduleId: string | null,
	enabled: boolean,
	currentRun: SimStatusResponse["run"] | null,
	sessionNonce: number,
): CompletionState {
	const [status, setStatus] = useState<LessonCompletionStatusResponse | null>(
		null,
	);
	const [loading, setLoading] = useState(false);
	const [marking, setMarking] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [freshRun, setFreshRun] = useState<{
		sessionKey: string;
		runId: string;
	} | null>(null);
	const [markedSession, setMarkedSession] = useState<string | null>(null);
	const lastSeenRun = useRef<{
		sessionKey: string;
		runId: string | null;
	} | null>(null);
	const sessionKey =
		enabled && workspaceSlug && moduleId
			? `${workspaceSlug}:${moduleId}:${sessionNonce}`
			: null;
	const runId = currentRun?.runId ?? null;
	const runStatus = currentRun?.status ?? "idle";
	const refreshKey = `${sessionKey ?? ""}:${runId ?? ""}:${runStatus}`;

	useEffect(() => {
		if (!sessionKey) {
			lastSeenRun.current = null;
			setFreshRun(null);
			setMarkedSession(null);
			return;
		}
		if (!currentRun) return;

		if (lastSeenRun.current?.sessionKey !== sessionKey) {
			lastSeenRun.current = { sessionKey, runId };
			setFreshRun(null);
			setMarkedSession(null);
			return;
		}

		if (lastSeenRun.current.runId !== runId) {
			lastSeenRun.current = { sessionKey, runId };
			setFreshRun(runId ? { sessionKey, runId } : null);
		}
	}, [currentRun, runId, sessionKey]);

	const load = useCallback(async () => {
		if (!workspaceSlug || !enabled) {
			setStatus(null);
			return;
		}
		setLoading(true);
		try {
			const response = await fetch(
				`/u/${workspaceSlug}/api/completion/status`,
				{ credentials: "same-origin" },
			);
			if (!response.ok) throw new Error("Unable to check lesson completion.");
			setStatus(
				lessonCompletionStatusResponseSchema.parse(await response.json()),
			);
		} catch (error) {
			setMessage(
				error instanceof Error ? error.message : "Unable to check completion.",
			);
		} finally {
			setLoading(false);
		}
	}, [enabled, workspaceSlug]);

	useEffect(() => {
		void refreshKey;
		setMessage(null);
		void load();
	}, [load, refreshKey]);

	const eligible =
		freshRun?.sessionKey === sessionKey &&
		freshRun.runId === runId &&
		status?.eligible === true &&
		status.run?.id === freshRun.runId;
	const completed = markedSession === sessionKey && sessionKey !== null;

	const mark = useCallback(async () => {
		if (!workspaceSlug || !sessionKey || !eligible || completed) return;
		setMarking(true);
		setMessage(null);
		try {
			const response = await fetch(`/u/${workspaceSlug}/api/completion/mark`, {
				method: "POST",
				credentials: "same-origin",
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(body?.error ?? "Unable to mark lesson complete.");
			}
			lessonCompletionResponseSchema.parse(await response.json());
			setMarkedSession(sessionKey);
			setMessage("Lesson marked complete.");
		} catch (error) {
			setMessage(
				error instanceof Error
					? error.message
					: "Unable to mark lesson complete.",
			);
		} finally {
			setMarking(false);
		}
	}, [completed, eligible, sessionKey, workspaceSlug]);

	return { status, eligible, completed, loading, marking, message, mark };
}
