import { describe, expect, test } from "bun:test";
import { listWorkspaceDiskLimitDevices } from "../containers/block-devices";

describe("listWorkspaceDiskLimitDevices", () => {
	test("returns nothing outside a container (daemon may be a VM with different devices)", () => {
		const devices = listWorkspaceDiskLimitDevices({
			dockerenvExists: () => false,
			readSysBlock: () => {
				throw new Error("should not be read on the host");
			},
		});
		expect(devices).toEqual([]);
	});

	test("keeps physical disks and drops virtual devices", () => {
		const devices = listWorkspaceDiskLimitDevices({
			dockerenvExists: () => true,
			readSysBlock: () => [
				"nvme1n1",
				"loop0",
				"ram3",
				"zram0",
				"dm-0",
				"md127",
				"nbd1",
				"fd0",
				"sr0",
				"sda",
				"nvme0n1",
				"vda",
			],
		});
		expect(devices).toEqual([
			"/dev/nvme0n1",
			"/dev/nvme1n1",
			"/dev/sda",
			"/dev/vda",
		]);
	});

	test("returns nothing when /sys/block is unreadable", () => {
		const devices = listWorkspaceDiskLimitDevices({
			dockerenvExists: () => true,
			readSysBlock: () => {
				throw new Error("ENOENT");
			},
		});
		expect(devices).toEqual([]);
	});
});
