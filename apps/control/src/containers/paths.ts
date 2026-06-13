import { isAbsolute, join, relative, resolve } from "node:path";
import type { ControlConfig } from "../config";

/**
 * Translate a control-plane-visible path under `dataDir` into the path the
 * Docker daemon sees on the host. When the control plane runs in a container
 * with the host data directory bind-mounted at `dataDir`, `docker run --mount
 * src=...` arguments must use the host-side location (`hostDataDir`), because
 * the daemon resolves them against the host filesystem.
 *
 * With `hostDataDir` unset (host/dev deployments) paths pass through
 * unchanged.
 */
export function toHostPath(config: ControlConfig, path: string): string {
	if (!config.hostDataDir) {
		return path;
	}
	const rel = relative(config.dataDir, resolve(path));
	if (rel === "") {
		return config.hostDataDir;
	}
	if (rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(
			`Refusing to translate "${path}" for a bind mount: it is outside the data directory ${config.dataDir}.`,
		);
	}
	return join(config.hostDataDir, rel);
}
