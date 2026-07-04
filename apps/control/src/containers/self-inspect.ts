import { existsSync, statSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import { resolve } from "node:path";
import { defaultDockerRunner, inspectContainer } from "./docker-client";
import type { DockerInspectContainer } from "./types";

/**
 * Zero-config detection for the containerized control plane.
 *
 * When the control plane runs inside a container it has the host Docker socket
 * bind-mounted, so it can `docker inspect` its own container to learn three
 * things that would otherwise need hand-wired env plumbing:
 *
 *   - `hostDataDir`   — the host-side path of the `/data` bind mount (the Docker
 *                       daemon resolves `docker run --mount src=...` against the
 *                       host filesystem, so workspace bind mounts must use it).
 *   - `containerNetwork` — the user-defined network this container is attached
 *                       to, which workspace containers must join as siblings.
 *   - `containerUser` — the uid:gid that owns the data dir, so student files are
 *                       not created as root.
 *
 * The three env vars (`FRC_HOST_DATA_DIR`, `FRC_CONTAINER_NETWORK`,
 * `FRC_CONTAINER_USER`) become optional overrides: an explicit value always
 * wins and its field is not derived. Inspection only fills the gaps.
 *
 * On the host (the dev loop) `/.dockerenv` is absent, so this returns
 * immediately with `containerized: false` and makes zero Docker calls — the
 * caller then leaves the config untouched (port mode).
 *
 * There is deliberately no fallback to port mode inside a container: port mode
 * publishes loopback host ports the containerized control plane cannot reach,
 * so a silent fallback would be a broken deployment. Every failure to derive a
 * still-needed field is a hard startup error that names the env var that fixes
 * it.
 */

const DEFAULT_NETWORKS = new Set(["bridge", "host", "none"]);

export type SelfInspectOptions = {
	/**
	 * In-container data dir, resolved the same way config does
	 * (`resolve(Bun.env.FRC_DATA_DIR ?? …)`). The image always sets
	 * `FRC_DATA_DIR=/data`, so this is `/data` in a real deployment.
	 */
	dataDir: string;
	/** Explicit `FRC_HOST_DATA_DIR` override, or null when unset. */
	envHostDataDir: string | null;
	/** Explicit `FRC_CONTAINER_NETWORK` override, or null when unset. */
	envContainerNetwork: string | null;
	/**
	 * Explicit workspace user override (`FRC_CONTAINER_USER`, or
	 * `FRC_UID`:`FRC_GID`), or null when unset.
	 */
	envContainerUser: string | null;

	// ── Injectable dependencies (defaults hit the real system) ──────────
	/** Whether this process runs inside a container. */
	dockerenvExists?: () => boolean;
	/** `docker inspect` runner; returns null when the container can't be read. */
	inspect?: (id: string) => Promise<DockerInspectContainer | null>;
	/** This container's id/hostname (compose sets the hostname to the id). */
	hostname?: () => string;
	/** stat() for the data dir, returning its owner uid/gid. */
	stat?: (path: string) => { uid: number; gid: number };
};

export type SelfInspectResult = {
	containerized: boolean;
	hostDataDir: string | null;
	containerNetwork: string | null;
	/** undefined when root-owned — left to the config root-guard to reject. */
	containerUser: string | undefined;
	/** Which fields came from inspection (vs. an explicit env override). */
	autoDetected: {
		hostDataDir: boolean;
		containerNetwork: boolean;
		containerUser: boolean;
	};
};

export async function selfInspect(
	options: SelfInspectOptions,
): Promise<SelfInspectResult> {
	const {
		dataDir,
		envHostDataDir,
		envContainerNetwork,
		envContainerUser,
		dockerenvExists = () => existsSync("/.dockerenv"),
		inspect = (id: string) => inspectContainer(defaultDockerRunner, id),
		hostname = osHostname,
		stat = defaultStat,
	} = options;

	// On the host the dev loop must behave byte-identically: no Docker calls, no
	// derived values.
	if (!dockerenvExists()) {
		return notDerived(envHostDataDir, envContainerNetwork, envContainerUser);
	}

	const needHostDataDir = envHostDataDir === null;
	const needNetwork = envContainerNetwork === null;
	const needUser = envContainerUser === null;

	// Everything explicitly configured — nothing to inspect.
	if (!needHostDataDir && !needNetwork && !needUser) {
		return {
			...notDerived(envHostDataDir, envContainerNetwork, envContainerUser),
			containerized: true,
		};
	}

	const id = hostname();
	let container: DockerInspectContainer | null;
	try {
		container = await inspect(id);
	} catch (error) {
		throw new Error(inspectFailureMessage(id, error));
	}
	if (!container) {
		throw new Error(inspectFailureMessage(id));
	}

	const hostDataDir = needHostDataDir
		? deriveHostDataDir(container, dataDir)
		: envHostDataDir;
	const containerNetwork = needNetwork
		? deriveNetwork(container)
		: envContainerNetwork;
	const containerUser = needUser
		? deriveContainerUser(stat, dataDir)
		: (envContainerUser ?? undefined);

	return {
		containerized: true,
		hostDataDir,
		containerNetwork,
		containerUser,
		autoDetected: {
			hostDataDir: needHostDataDir,
			containerNetwork: needNetwork,
			// Root-owned dirs are intentionally not derived (containerUser stays
			// undefined), so they are not "auto-detected" either.
			containerUser: needUser && containerUser !== undefined,
		},
	};
}

function defaultStat(path: string): { uid: number; gid: number } {
	const s = statSync(path);
	return { uid: s.uid, gid: s.gid };
}

function notDerived(
	hostDataDir: string | null,
	containerNetwork: string | null,
	containerUser: string | null,
): SelfInspectResult {
	return {
		containerized: false,
		hostDataDir,
		containerNetwork,
		containerUser: containerUser ?? undefined,
		autoDetected: {
			hostDataDir: false,
			containerNetwork: false,
			containerUser: false,
		},
	};
}

function deriveHostDataDir(
	container: DockerInspectContainer,
	dataDir: string,
): string {
	const target = resolve(dataDir);
	const mount = (container.Mounts ?? []).find(
		(m) =>
			typeof m.Destination === "string" && resolve(m.Destination) === target,
	);
	if (!mount?.Source) {
		throw new Error(
			`Could not auto-detect the host-side data directory: no bind mount in ` +
				`this container has destination ${target}. Set FRC_HOST_DATA_DIR to the ` +
				`host path of the data directory.`,
		);
	}
	return mount.Source;
}

function deriveNetwork(container: DockerInspectContainer): string {
	const networks = Object.keys(
		container.NetworkSettings?.Networks ?? {},
	).filter((name) => !DEFAULT_NETWORKS.has(name));
	if (networks.length === 1) {
		return networks[0]!;
	}
	const found =
		networks.length === 0
			? "none"
			: `${networks.length} (${networks.join(", ")})`;
	throw new Error(
		`Could not auto-detect the workspace container network: expected exactly ` +
			`one user-defined network attached to this container, found ${found}. Set ` +
			`FRC_CONTAINER_NETWORK to the network workspace containers should join.`,
	);
}

function deriveContainerUser(
	stat: (path: string) => { uid: number; gid: number },
	dataDir: string,
): string | undefined {
	const { uid, gid } = stat(dataDir);
	// Root-owned: do NOT derive. Leaving this undefined lets the config
	// root-guard fire (chown the data dir, or set FRC_CONTAINER_USER, to fix).
	if (uid === 0 && gid === 0) {
		return undefined;
	}
	return `${uid}:${gid}`;
}

function inspectFailureMessage(id: string, error?: unknown): string {
	const detail =
		error instanceof Error ? `: ${error.message}` : error ? `: ${error}` : "";
	return (
		`Failed to inspect this control-plane container ("${id}")${detail}. The ` +
		`containerized control plane auto-detects FRC_HOST_DATA_DIR, ` +
		`FRC_CONTAINER_NETWORK, and FRC_CONTAINER_USER from its own container; set ` +
		`those three environment variables manually to override when inspection is ` +
		`unavailable.`
	);
}
