import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SimStatusResponse } from "@/lib/contracts";
import { useLessonCompletion } from "./useLessonCompletion";

function statusResponse(eligible: boolean, runId: string | null): Response {
	return new Response(
		JSON.stringify({
			ok: true,
			eligible,
			reason: eligible ? null : "Start the robot and pass all tests.",
			run: runId
				? {
						id: runId,
						testsTotal: 2,
						testsPassed: eligible ? 2 : 1,
						testsFailed: eligible ? 0 : 1,
						testsSkipped: 0,
					}
				: null,
		}),
		{ headers: { "content-type": "application/json" } },
	);
}

function markResponse(): Response {
	return new Response(
		JSON.stringify({
			ok: true,
			completion: {
				id: "completion_1",
				completedAt: new Date(0).toISOString(),
				moduleId: "robot-starter",
			},
		}),
		{ headers: { "content-type": "application/json" } },
	);
}

const run = (runId: string, status: SimStatusResponse["run"]["status"]) => ({
	runId,
	status,
});

describe("useLessonCompletion", () => {
	afterEach(() => vi.unstubAllGlobals());

	test("ignores a historical run and follows newer passing or failed attempts", async () => {
		let currentStatus = statusResponse(true, "old-run");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => currentStatus),
		);
		const { result, rerender } = renderHook(
			({ currentRun }) =>
				useLessonCompletion("alice", "robot-starter", true, currentRun, 0),
			{
				initialProps: {
					currentRun: run("old-run", "stopped"),
				},
			},
		);

		await waitFor(() => expect(result.current.status?.eligible).toBe(true));
		expect(result.current.eligible).toBe(false);

		currentStatus = statusResponse(true, "new-run");
		rerender({ currentRun: run("new-run", "building") });
		await waitFor(() => expect(result.current.eligible).toBe(true));

		currentStatus = statusResponse(false, "failed-run");
		rerender({ currentRun: run("failed-run", "building") });
		await waitFor(() => expect(result.current.status?.eligible).toBe(false));
		expect(result.current.eligible).toBe(false);
	});

	test("keeps the marked label for this lesson session and resets on remount", async () => {
		let reportedRunId = "old-run";
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) =>
				String(input).endsWith("/api/completion/mark")
					? markResponse()
					: statusResponse(true, reportedRunId),
			),
		);
		const initialProps = { currentRun: run("old-run", "stopped") };
		const { result, rerender, unmount } = renderHook(
			({ currentRun, sessionNonce }) =>
				useLessonCompletion(
					"alice",
					"robot-starter",
					true,
					currentRun,
					sessionNonce,
				),
			{ initialProps: { ...initialProps, sessionNonce: 0 } },
		);

		await waitFor(() => expect(result.current.status?.eligible).toBe(true));
		reportedRunId = "new-run";
		rerender({ currentRun: run("new-run", "running"), sessionNonce: 0 });
		await waitFor(() => expect(result.current.status?.run?.id).toBe("new-run"));
		await waitFor(() => expect(result.current.eligible).toBe(true));
		await act(async () => result.current.mark());
		expect(result.current.completed).toBe(true);
		rerender({ currentRun: run("new-run", "running"), sessionNonce: 1 });
		expect(result.current.completed).toBe(false);
		expect(result.current.eligible).toBe(false);

		unmount();
		const reopened = renderHook(() =>
			useLessonCompletion(
				"alice",
				"robot-starter",
				true,
				initialProps.currentRun,
				0,
			),
		);
		await waitFor(() =>
			expect(reopened.result.current.status?.eligible).toBe(true),
		);
		expect(reopened.result.current.completed).toBe(false);
		expect(reopened.result.current.eligible).toBe(false);
	});
});
