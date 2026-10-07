import { createServer } from "node:net";

export async function portIsFree(port: number): Promise<boolean> {
	return await new Promise<boolean>((resolvePort) => {
		const server = createServer();
		let settled = false;

		const settle = (free: boolean) => {
			if (settled) return;
			settled = true;
			if (free) {
				server.close(() => resolvePort(true));
			} else {
				resolvePort(false);
			}
		};

		const eventedServer = server as unknown as {
			once(event: "error", listener: () => void): void;
		};
		eventedServer.once("error", () => settle(false));
		server.listen({ host: "127.0.0.1", port }, () => settle(true));
	});
}
