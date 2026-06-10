import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { useProjectSwap } from "./useProjectSwap";

type Listener = (event: unknown) => void;

class FakeSocket {
	static instances: FakeSocket[] = [];

	url: string;
	sent: string[] = [];
	private listeners: Record<string, Listener[]> = {};

	constructor(url: string) {
		this.url = url;
		FakeSocket.instances.push(this);
	}

	addEventListener(event: string, listener: Listener) {
		const listeners = this.listeners[event] ?? [];
		listeners.push(listener);
		this.listeners[event] = listeners;
	}

	send(payload: string) {
		this.sent.push(payload);
	}

	close() {
		this.fire("close");
	}

	fire(event: string, payload?: unknown) {
		for (const listener of this.listeners[event] ?? []) {
			listener(payload);
		}
	}

	open() {
		this.fire("open");
	}

	message(data: unknown) {
		this.fire("message", {
			data: typeof data === "string" ? data : JSON.stringify(data),
		});
	}
}

describe("useProjectSwap", () => {
	const originalWS = globalThis.WebSocket;

	beforeEach(() => {
		FakeSocket.instances = [];
		// @ts-expect-error overriding global for test
		globalThis.WebSocket = FakeSocket;
	});

	afterEach(() => {
		// @ts-expect-error restore
		globalThis.WebSocket = originalWS;
	});

	test("does not connect when slug is null", () => {
		const { result } = renderHook(() => useProjectSwap(null));
		act(() => result.current.startSwap({ kind: "lesson", moduleId: "hello" }));
		expect(FakeSocket.instances).toHaveLength(0);
		expect(result.current.state.status).toBe("idle");
	});

	test("lesson swaps use /ws/lesson-load and send the module id", () => {
		const { result } = renderHook(() => useProjectSwap("alice"));
		act(() =>
			result.current.startSwap({ kind: "lesson", moduleId: "hello-world" }),
		);
		const socket = FakeSocket.instances[0]!;
		expect(socket.url).toMatch(/\/u\/alice\/ws\/lesson-load$/);

		act(() => socket.open());
		expect(socket.sent).toEqual([JSON.stringify({ moduleId: "hello-world" })]);
		expect(result.current.state.status).toBe("running");
	});

	test("team imports use /ws/import and send the repo url", () => {
		const { result } = renderHook(() => useProjectSwap("alice"));
		act(() =>
			result.current.startSwap({
				kind: "import",
				url: "https://github.com/team/robot",
			}),
		);
		const socket = FakeSocket.instances[0]!;
		expect(socket.url).toMatch(/\/u\/alice\/ws\/import$/);

		act(() => socket.open());
		expect(socket.sent).toEqual([
			JSON.stringify({ url: "https://github.com/team/robot" }),
		]);
	});

	test("streamed done message records the final success state", () => {
		const { result } = renderHook(() => useProjectSwap("alice"));
		act(() =>
			result.current.startSwap({ kind: "lesson", moduleId: "robot-starter" }),
		);
		const socket = FakeSocket.instances[0]!;
		act(() => socket.open());
		act(() =>
			socket.message({
				type: "progress",
				stage: "swapping",
				detail: "Replacing project files...",
			}),
		);
		expect(result.current.state.stage).toBe("swapping");

		act(() =>
			socket.message({
				type: "done",
				success: true,
				message: "Lesson loaded successfully.",
			}),
		);
		expect(result.current.state).toMatchObject({
			status: "done",
			success: true,
			stage: "complete",
			message: "Lesson loaded successfully.",
		});
	});

	test("unexpected close while running becomes an error", () => {
		const { result } = renderHook(() => useProjectSwap("alice"));
		act(() =>
			result.current.startSwap({ kind: "lesson", moduleId: "hello-world" }),
		);
		const socket = FakeSocket.instances[0]!;
		act(() => socket.open());
		act(() => socket.close());
		expect(result.current.state).toMatchObject({
			status: "error",
			success: false,
			message: "Connection closed unexpectedly.",
		});
	});
});
