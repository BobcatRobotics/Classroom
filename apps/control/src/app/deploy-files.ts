import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import {
	DEPLOY_FILES_READ_ROOTS,
	DEPLOY_FILES_WRITE_ROOT,
	type DeployFile,
	deployFilePathSchema,
} from "@frc-coderunner/contracts";
import { getLogger } from "../logging";
import { isInsideDirectory } from "./assets";
import { jsonResponse } from "./responses";

const log = getLogger("deploy-files");

/**
 * Per-file ceiling for reads and writes. PathPlanner files are small JSON
 * (paths/autos are a few KB, navgrid a few hundred KB); anything bigger is
 * not ours to sync.
 */
const MAX_DEPLOY_FILE_BYTES = 5 * 1024 * 1024;

type DeployWorkspace = { project_path: string };

/** Decode and validate the path suffix of /api/deploy-files/<path>. */
export function parseDeployFilePath(rawSuffix: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(rawSuffix);
	} catch {
		return null;
	}
	const parsed = deployFilePathSchema.safeParse(decoded);
	return parsed.success ? parsed.data : null;
}

function isWritableDeployPath(path: string): boolean {
	return path.startsWith(`${DEPLOY_FILES_WRITE_ROOT}/`);
}

/** Resolve a validated relative path inside the project, or null on escape. */
function resolveInProject(
	workspace: DeployWorkspace,
	path: string,
): string | null {
	const projectRoot = resolve(workspace.project_path);
	const target = resolve(projectRoot, path);
	return isInsideDirectory(projectRoot, target) ? target : null;
}

async function collectFiles(
	directory: string,
	rootDir: string,
	rootPrefix: string,
	out: DeployFile[],
): Promise<void> {
	const entries = await readdir(directory, { withFileTypes: true }).catch(
		() => null,
	);
	if (!entries) {
		return;
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".")) {
			continue;
		}
		const absolutePath = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			await collectFiles(absolutePath, rootDir, rootPrefix, out);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		const fileStat = await stat(absolutePath).catch(() => null);
		if (!fileStat || fileStat.size > MAX_DEPLOY_FILE_BYTES) {
			log.warn("deploy-files snapshot skipped oversized file", {
				path: absolutePath,
			});
			continue;
		}
		const rel = relative(rootDir, absolutePath).split(sep).join("/");
		out.push({
			path: `${rootPrefix}/${rel}`,
			content: await Bun.file(absolutePath).text(),
		});
	}
}

export async function deployFilesSnapshotResponse(
	workspace: DeployWorkspace,
): Promise<Response> {
	const files: DeployFile[] = [];
	for (const root of DEPLOY_FILES_READ_ROOTS) {
		const rootDir = resolve(workspace.project_path, root);
		await collectFiles(rootDir, rootDir, root, files);
	}
	return jsonResponse({ ok: true, files });
}

export async function deployFileWriteResponse(
	workspace: DeployWorkspace,
	path: string,
	request: Request,
): Promise<Response> {
	if (!isWritableDeployPath(path)) {
		return jsonResponse(
			{ error: "Only files under the PathPlanner deploy dir are writable." },
			{ status: 403 },
		);
	}
	const body = await request.text();
	if (Buffer.byteLength(body, "utf8") > MAX_DEPLOY_FILE_BYTES) {
		return jsonResponse({ error: "File is too large." }, { status: 413 });
	}
	const target = resolveInProject(workspace, path);
	if (!target) {
		return jsonResponse(
			{ error: "Invalid deploy file path." },
			{ status: 400 },
		);
	}
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, body, "utf8");
	return jsonResponse({ ok: true });
}

export async function deployFileDeleteResponse(
	workspace: DeployWorkspace,
	path: string,
): Promise<Response> {
	if (!isWritableDeployPath(path)) {
		return jsonResponse(
			{ error: "Only files under the PathPlanner deploy dir are writable." },
			{ status: 403 },
		);
	}
	const target = resolveInProject(workspace, path);
	if (!target) {
		return jsonResponse(
			{ error: "Invalid deploy file path." },
			{ status: 400 },
		);
	}
	const fileStat = await stat(target).catch(() => null);
	if (!fileStat || !fileStat.isFile()) {
		return jsonResponse({ error: "File not found." }, { status: 404 });
	}
	await rm(target);
	return jsonResponse({ ok: true });
}
