import {
	configureLogging,
	defaultLogFormat,
	defaultLogLevel,
	getLogger,
} from "./logging";
import { enableDefaultMetrics } from "./metrics";

await configureLogging(defaultLogLevel(), defaultLogFormat());
enableDefaultMetrics();

const log = getLogger("boot");

const { createApp } = await import("./app");

const demoFlag = Bun.argv.includes("--demo");

const port = Number(Bun.env.PORT ?? 4000);
const app = await createApp(demoFlag ? { demo: true } : {});
const c = app.storage.config;

if (c.demo) {
	const banner = [
		"================================================================",
		"  DEMO MODE ENABLED — authentication is bypassed.",
		"  Every visitor logs in as the same admin user and shares one",
		"  workspace. DO NOT deploy this instance publicly.",
		"================================================================",
	];
	for (const line of banner) log.warn(line);
}

// In network mode workspace containers publish no host ports, so the port
// ranges do not bound concurrency — MAX_ACTIVE_CONTAINERS does.
const maxStudents = c.containerNetwork
	? c.maxActiveContainers
	: Math.min(
			c.simPortRange.end - c.simPortRange.start + 1,
			c.vscodePortRange.end - c.vscodePortRange.start + 1,
		);

log.info("control plane configuration", {
	logLevel: c.logLevel,
	dataDir: c.dataDir,
	hostDataDir: c.hostDataDir ?? "(same as dataDir)",
	codeImage: c.codeImage,
	codeMemoryLimit: c.codeMemoryLimit,
	containerNetwork: c.containerNetwork ?? "(none — loopback published ports)",
	simPorts: c.containerNetwork
		? "(unused in network mode)"
		: `${c.simPortRange.start}-${c.simPortRange.end}`,
	vscodePorts: c.containerNetwork
		? "(unused in network mode)"
		: `${c.vscodePortRange.start}-${c.vscodePortRange.end}`,
	buildTimeoutSec: c.runBuildTimeoutMs / 1000,
	simStartupSec: c.simStartupTimeoutMs / 1000,
	idleStopMinutes: c.idleStopMinutes,
	idleCheckSec: c.idleCheckIntervalMs / 1000,
	containerUser: c.containerUser ?? "(auto)",
	containerAutoStart: c.containerAutoStart,
	adminAuth: c.demo
		? "demo mode (auth bypassed)"
		: c.adminToken
			? "better-auth + bearer break-glass"
			: "better-auth admin role",
	maxStudents,
});

const server = Bun.serve({
	port,
	fetch: (request, server) => app.fetch(request, server),
	websocket: app.websocket,
	idleTimeout: 30,
});

log.info("listening", {
	url: `http://localhost:${server.port}`,
	port: server.port,
});
