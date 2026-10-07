import { desktopLessonCompletionSyncSchema } from "@frc-coderunner/contracts";
import { getLogger } from "./logging";
import type { AppStorage } from "./storage";

const log = getLogger("lesson-completion-sync");
const SYNC_INTERVAL_MS = 15_000;

export class LessonCompletionSync {
	private timer: ReturnType<typeof setInterval> | null = null;
	private syncing = false;
	private readonly endpoint: URL;

	constructor(
		private readonly storage: AppStorage,
		private readonly runtimeTicket: string,
		centralUrl: string,
		private readonly fetchImpl: (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => Promise<Response> = fetch,
	) {
		this.endpoint = new URL("/api/launcher/lesson-completions", centralUrl);
		const isLoopbackHttp =
			this.endpoint.protocol === "http:" &&
			["localhost", "127.0.0.1"].includes(this.endpoint.hostname);
		if (
			(this.endpoint.protocol !== "https:" && !isLoopbackHttp) ||
			this.endpoint.username ||
			this.endpoint.password
		) {
			throw new Error(
				"CodeRunner sign-in requires a trusted HTTPS server URL.",
			);
		}
	}

	start(): void {
		if (this.timer) return;
		void this.syncPending();
		this.timer = setInterval(() => void this.syncPending(), SYNC_INTERVAL_MS);
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	async syncPending(): Promise<void> {
		if (this.syncing) return;
		this.syncing = true;
		try {
			for (const pending of this.storage.listPendingLessonCompletionSync()) {
				if (!pending.source_event_id) continue;
				const payload = desktopLessonCompletionSyncSchema.parse({
					eventId: pending.source_event_id,
					moduleId: pending.module_id,
					testsTotal: pending.tests_total,
					testsPassed: pending.tests_passed,
					testsFailed: pending.tests_failed,
					testsSkipped: pending.tests_skipped,
				});
				const response = await this.fetchImpl(this.endpoint, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.runtimeTicket}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(payload),
					signal: AbortSignal.timeout(10_000),
				});
				if (!response.ok) {
					throw new Error(
						`Central completion sync returned ${response.status}.`,
					);
				}
				this.storage.markLessonCompletionSynced(pending.id);
			}
		} catch (error) {
			log.warn("desktop lesson completion sync will retry", {
				err: error instanceof Error ? error : new Error(String(error)),
			});
		} finally {
			this.syncing = false;
		}
	}
}
