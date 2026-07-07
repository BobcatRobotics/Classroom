import { existsSync, readdirSync } from "node:fs";
import { getLogger } from "../logging";

const log = getLogger("containers");

/**
 * Host block devices that workspace `--device-read-bps` limits apply to.
 *
 * `/sys/block` lists whole devices only (no partitions), which is exactly the
 * granularity cgroup io.max throttles at. Virtual devices (loop, ram, zram,
 * device-mapper, md, nbd, floppy, cdrom) are skipped — throttling them would
 * be meaningless or double-count the physical disk underneath.
 *
 * Detection is gated on running inside a container (`/.dockerenv`): a
 * containerized control plane shares the Docker daemon host's kernel, so its
 * `/sys/block` names match the `/dev` paths the daemon resolves. On the bare
 * host that assumption breaks for VM-backed daemons (Docker Desktop), where
 * the daemon's devices are not the host's — so the dev loop applies no
 * limits rather than passing paths the daemon may reject.
 */
const VIRTUAL_DEVICE_PATTERN = /^(loop|ram|zram|dm-|md|nbd|fd|sr)/u;

export type ListBlockDevicesOptions = {
	dockerenvExists?: () => boolean;
	readSysBlock?: () => string[];
};

export function listWorkspaceDiskLimitDevices(
	options: ListBlockDevicesOptions = {},
): string[] {
	const {
		dockerenvExists = () => existsSync("/.dockerenv"),
		readSysBlock = () => readdirSync("/sys/block"),
	} = options;

	if (!dockerenvExists()) {
		return [];
	}

	let names: string[];
	try {
		names = readSysBlock();
	} catch (err) {
		log.warn("could not read /sys/block; workspace disk read limit disabled", {
			err: err instanceof Error ? err : new Error(String(err)),
		});
		return [];
	}

	const devices = names
		.filter((name) => !VIRTUAL_DEVICE_PATTERN.test(name))
		.sort()
		.map((name) => `/dev/${name}`);

	if (devices.length === 0) {
		log.warn(
			"no physical block devices found in /sys/block; workspace disk read limit disabled",
		);
	}

	return devices;
}
