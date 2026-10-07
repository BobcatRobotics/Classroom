import { describe, expect, test } from "bun:test";
import { LessonCompletionSync } from "./lesson-completion-sync";
import type { AppStorage } from "./storage";

describe("LessonCompletionSync", () => {
	test("keeps failed deliveries queued and removes successful deliveries", async () => {
		const pending = [
			{
				id: `completion_${"a".repeat(32)}`,
				module_id: "robot-starter",
				lesson_title: "Robot Starter",
				tests_total: 1,
				tests_passed: 1,
				tests_failed: 0,
				tests_skipped: 0,
				source_event_id: `completion_${"b".repeat(32)}`,
			},
		];
		const storage = {
			listPendingLessonCompletionSync: () => [...pending],
			markLessonCompletionSynced: (id: string) => {
				const index = pending.findIndex((item) => item.id === id);
				if (index !== -1) pending.splice(index, 1);
			},
		} as unknown as AppStorage;
		let failDelivery = true;
		const sync = new LessonCompletionSync(
			storage,
			"a".repeat(43),
			"https://central.example",
			async (input, init) => {
				expect(String(input)).toBe(
					"https://central.example/api/launcher/lesson-completions",
				);
				expect(new Headers(init?.headers).get("authorization")).toBe(
					`Bearer ${"a".repeat(43)}`,
				);
				return new Response(null, { status: failDelivery ? 503 : 200 });
			},
		);

		await sync.syncPending();
		expect(pending).toHaveLength(1);
		failDelivery = false;
		await sync.syncPending();
		expect(pending).toHaveLength(0);
	});
});
