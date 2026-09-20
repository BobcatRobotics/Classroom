import { useCallback, useEffect, useState } from "react";
import {
	type LessonCompletionStatusResponse,
	lessonCompletionResponseSchema,
	lessonCompletionStatusResponseSchema,
} from "@/lib/contracts";

type CompletionState = {
	status: LessonCompletionStatusResponse | null;
	loading: boolean;
	marking: boolean;
	message: string | null;
	mark: () => Promise<void>;
};

export function useLessonCompletion(
	workspaceSlug: string | null,
	enabled: boolean,
	refreshKey: unknown,
): CompletionState {
	const [status, setStatus] = useState<LessonCompletionStatusResponse | null>(
		null,
	);
	const [loading, setLoading] = useState(false);
	const [marking, setMarking] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

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

	const mark = useCallback(async () => {
		if (!workspaceSlug || !status?.eligible) return;
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
			setMessage("Lesson marked complete.");
			await load();
		} catch (error) {
			setMessage(
				error instanceof Error
					? error.message
					: "Unable to mark lesson complete.",
			);
		} finally {
			setMarking(false);
		}
	}, [load, status?.eligible, workspaceSlug]);

	return { status, loading, marking, message, mark };
}
