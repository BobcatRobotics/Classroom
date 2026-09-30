import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
	AdminActionResponse,
	WorkspaceId,
} from "@frc-coderunner/contracts";
import { queryAuditLog, recordAuditEvent } from "../audit";
import { requireAdmin } from "../auth/middleware";
import { getLogger } from "../logging";
import type { RunManager } from "../runs";
import type { WorkspaceRuntimeProvider } from "../runtime";
import type { AppStorage } from "../storage";
import {
	createProjectArchive,
	directorySizeBytes,
	restoreProjectArchive,
} from "./archive-utils";
import { isInsideDirectory, webAssetResponse } from "./assets";
import { apiErrorResponse, jsonResponse, notFound } from "./responses";
import { adminStatusResponse, auditActor } from "./status";

const log = getLogger("admin");

export type AdminRouteContext = {
	storage: AppStorage;
	runs: RunManager;
	runtimeProvider: WorkspaceRuntimeProvider;
};

type LessonCompletionReportRow = {
	student_id: string;
	user_name: string;
	user_slug: string | null;
	lesson_title: string;
	completed_at: string;
	build_succeeded: number;
	test_passed: number;
	tests_total: number;
	tests_passed: number;
	tests_failed: number;
	tests_skipped: number;
	run_job_id: string;
	log_path: string | null;
};

const reportSortColumns: Record<string, string> = {
	user_name: "u.name",
	user_slug: "u.slug",
	lesson_title: "c.lesson_title",
	completed_at: "c.completed_at",
	build_succeeded: "c.build_succeeded",
	test_passed: "c.test_passed",
	tests_total: "c.tests_total",
	tests_passed: "c.tests_passed",
	tests_failed: "c.tests_failed",
	tests_skipped: "c.tests_skipped",
	log_path: "r.log_path",
};

function isValidDateOnly(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	try {
		return (
			new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
		);
	} catch {
		return false;
	}
}

function csvCell(value: string | number | null): string {
	const text = String(value ?? "");
	const safeText = /^[\s]*[=+\-@]/u.test(text) ? `'${text}` : text;
	return `"${safeText.replaceAll('"', '""')}"`;
}

function lessonCompletionReportQuery(filters: {
	studentId: string | null;
	moduleId: string | null;
	from: string | null;
	to: string | null;
	latestOnly: boolean;
}): { where: string; values: string[] } {
	const conditions: string[] = [];
	const values: string[] = [];
	if (filters.studentId) {
		conditions.push("c.student_id = ?");
		values.push(filters.studentId);
	}
	if (filters.moduleId) {
		conditions.push("c.module_id = ?");
		values.push(filters.moduleId);
	}
	if (filters.from) {
		conditions.push("c.completed_at >= ?");
		values.push(`${filters.from}T00:00:00.000Z`);
	}
	if (filters.to) {
		conditions.push("c.completed_at < date(?, '+1 day')");
		values.push(filters.to);
	}
	if (filters.latestOnly) {
		conditions.push(`NOT EXISTS (
			SELECT 1 FROM lesson_completions newer
			WHERE newer.student_id = c.student_id
			  AND newer.module_id = c.module_id
			  AND (newer.completed_at > c.completed_at
			    OR (newer.completed_at = c.completed_at AND newer.id > c.id))
		)`);
	}
	return {
		where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
		values,
	};
}

const lessonCompletionReportSelect = `
	SELECT c.student_id, u.name AS user_name, u.slug AS user_slug,
		c.lesson_title, c.completed_at, c.build_succeeded, c.test_passed,
		c.tests_total, c.tests_passed, c.tests_failed, c.tests_skipped,
		r.id AS run_job_id, r.log_path
	FROM lesson_completions c
	JOIN user u ON u.id = c.student_id
	JOIN run_jobs r ON r.id = c.run_job_id
`;

export async function handleAdminRoute(
	ctx: AdminRouteContext,
	url: URL,
	request: Request,
): Promise<Response> {
	const { storage, runs, runtimeProvider } = ctx;
	const adminResult = await requireAdmin(storage, request);
	if (adminResult instanceof Response) {
		return adminResult;
	}
	log.debug("admin route", {
		method: request.method,
		path: url.pathname,
		actor: adminResult.user.id,
	});

	// Serve static assets for the admin SPA
	if (url.pathname.startsWith("/admin/assets/") && request.method === "GET") {
		return webAssetResponse(
			storage,
			`assets/${url.pathname.slice("/admin/assets/".length)}`,
		);
	}

	if (url.pathname === "/admin/status" && request.method === "GET") {
		return jsonResponse(adminStatusResponse(storage, runs));
	}

	if (
		url.pathname === "/admin/lesson-completions/options" &&
		request.method === "GET"
	) {
		const users = storage.db
			.query(
				`SELECT DISTINCT u.id, u.name, u.slug
				 FROM lesson_completions c
				 JOIN user u ON u.id = c.student_id
				 ORDER BY u.name, u.slug`,
			)
			.all();
		const lessons = storage.db
			.query(
				`SELECT DISTINCT module_id, lesson_title
				 FROM lesson_completions
				 ORDER BY lesson_title, module_id`,
			)
			.all();
		return jsonResponse({ ok: true, users, lessons });
	}

	if (
		url.pathname === "/admin/lesson-completions" &&
		request.method === "GET"
	) {
		const studentId = url.searchParams.get("studentId")?.trim() || null;
		const moduleId = url.searchParams.get("moduleId")?.trim() || null;
		const from = url.searchParams.get("from") || null;
		const to = url.searchParams.get("to") || null;
		const latestOnly = url.searchParams.get("latest") === "true";
		if (
			(from !== null && !isValidDateOnly(from)) ||
			(to !== null && !isValidDateOnly(to)) ||
			(from !== null && to !== null && from > to)
		) {
			return jsonResponse(
				{ error: "Invalid completion date range." },
				{ status: 400 },
			);
		}

		const sort = url.searchParams.get("sort") ?? "completed_at";
		const direction =
			url.searchParams.get("direction") === "desc" ? "DESC" : "ASC";
		const sortColumn = reportSortColumns[sort];
		if (!sortColumn) {
			return jsonResponse(
				{ error: "Invalid report sort column." },
				{ status: 400 },
			);
		}
		const filters = { studentId, moduleId, from, to, latestOnly };
		const { where, values } = lessonCompletionReportQuery(filters);
		const orderBy = `ORDER BY ${sortColumn} ${direction}, c.completed_at ASC, c.id ASC`;
		const exportCsv = url.searchParams.get("format") === "csv";
		const reportQuery = `${lessonCompletionReportSelect} ${where} ${orderBy}`;
		if (exportCsv) {
			const rows = storage.db
				.query(reportQuery)
				.all(...values) as LessonCompletionReportRow[];
			const headers = [
				"user_name",
				"user_slug",
				"lesson_title",
				"completed_at",
				"build_succeeded",
				"test_passed",
				"tests_total",
				"tests_passed",
				"tests_failed",
				"tests_skipped",
				"log_path",
			];
			const lines = [headers.map((header) => csvCell(header)).join(",")];
			for (const row of rows) {
				lines.push(
					[
						row.user_name,
						row.user_slug,
						row.lesson_title,
						row.completed_at,
						row.build_succeeded,
						row.test_passed,
						row.tests_total,
						row.tests_passed,
						row.tests_failed,
						row.tests_skipped,
						row.log_path
							? `/admin/run-logs/${encodeURIComponent(row.run_job_id)}`
							: null,
					]
						.map((value) => csvCell(value))
						.join(","),
				);
			}
			return new Response(`${lines.join("\r\n")}\r\n`, {
				headers: {
					"Content-Type": "text/csv; charset=utf-8",
					"Content-Disposition":
						'attachment; filename="lesson-completion-report.csv"',
					"Cache-Control": "no-store",
				},
			});
		}
		const count = storage.db
			.query(
				`SELECT COUNT(*) AS total
				 FROM lesson_completions c
				 JOIN user u ON u.id = c.student_id
				 ${where}`,
			)
			.get(...values) as { total: number };

		const rawPage = Number(url.searchParams.get("page") ?? 1);
		const rawPageSize = Number(url.searchParams.get("pageSize") ?? 20);
		if (
			!Number.isInteger(rawPage) ||
			rawPage < 1 ||
			!([20, 50, 100] as const).includes(rawPageSize as 20 | 50 | 100)
		) {
			return jsonResponse(
				{ error: "Invalid report pagination." },
				{ status: 400 },
			);
		}
		const rows = storage.db
			.query(`${reportQuery} LIMIT ? OFFSET ?`)
			.all(
				...values,
				rawPageSize,
				(rawPage - 1) * rawPageSize,
			) as LessonCompletionReportRow[];
		return jsonResponse({
			ok: true,
			rows: rows.map((row) => ({
				...row,
				log_url: row.log_path
					? `/admin/run-logs/${encodeURIComponent(row.run_job_id)}`
					: null,
			})),
			total: count.total,
			page: rawPage,
			pageSize: rawPageSize,
		});
	}

	const runLogMatch = /^\/admin\/run-logs\/([^/]+)$/.exec(url.pathname);
	if (runLogMatch && request.method === "GET") {
		const runJobId = runLogMatch[1] ?? "";
		const run = storage.db
			.query("SELECT id, workspace_id, log_path FROM run_jobs WHERE id = ?")
			.get(runJobId) as {
			id: string;
			workspace_id: string;
			log_path: string | null;
		} | null;
		if (!run?.log_path) return notFound();
		const logPath = resolve(
			storage.config.dataDir,
			"users",
			run.workspace_id,
			"logs",
			"runs",
			`${run.id}.log`,
		);
		if (!isInsideDirectory(resolve(storage.config.dataDir), logPath)) {
			return jsonResponse({ error: "Log path is invalid." }, { status: 403 });
		}
		try {
			const contents = await readFile(logPath);
			return new Response(contents, {
				headers: {
					"Content-Type": "text/plain; charset=utf-8",
					"Content-Disposition": `inline; filename="${run.id}.log"`,
					"X-Content-Type-Options": "nosniff",
					"Cache-Control": "no-store",
				},
			});
		} catch {
			return notFound();
		}
	}

	if (url.pathname === "/admin/containers/stats" && request.method === "GET") {
		const workspacesById = new Map(
			storage
				.listAllWorkspacesWithLeases()
				.map((entry) => [entry.workspace.id, entry]),
		);
		const stats = await runtimeProvider.listRuntimes();
		return jsonResponse({
			ok: true,
			containers: stats.map((container) => {
				const entry = container.workspaceId
					? workspacesById.get(container.workspaceId as WorkspaceId)
					: undefined;
				const lease = entry?.lease ?? null;
				return {
					...container,
					workspaceSlug: entry?.workspace.slug ?? null,
					ports: {
						nt4: lease?.nt4_port ?? null,
						vscode: lease?.vscode_port ?? null,
						halsim: lease?.halsim_port ?? null,
					},
				};
			}),
		});
	}

	if (
		url.pathname === "/admin/workspaces/disk-usage" &&
		request.method === "GET"
	) {
		const entries = storage.listAllWorkspacesWithLeases();
		const usage = await Promise.all(
			entries.map(async (entry) => ({
				workspaceId: entry.workspace.id,
				workspaceSlug: entry.workspace.slug,
				projectPath: entry.workspace.project_path,
				bytes: await directorySizeBytes(entry.workspace.project_path),
			})),
		);
		return jsonResponse({ ok: true, workspaces: usage });
	}

	const adminWorkspaceMatch = /^\/admin\/workspaces\/([^/]+)\/(.+)$/.exec(
		url.pathname,
	);
	if (adminWorkspaceMatch && request.method === "POST") {
		const targetWorkspaceId = adminWorkspaceMatch[1] ?? "";
		const action = adminWorkspaceMatch[2] ?? "";
		const workspace = storage.findWorkspaceById(
			targetWorkspaceId as WorkspaceId,
		);
		if (!workspace) {
			return jsonResponse({ error: "Workspace not found." }, { status: 404 });
		}

		const actor = auditActor(adminResult);

		try {
			if (action === "restart-code") {
				await runtimeProvider.restartWorkspace(workspace.id);
				recordAuditEvent(storage, {
					actor,
					action: "container.restart-code",
					target: { kind: "workspace", id: workspace.id },
				});
				return jsonResponse({
					ok: true,
					action: "restart-code",
					workspaceId: workspace.id,
					detail: "Code container restarted.",
				} satisfies AdminActionResponse);
			}

			if (action === "stop-containers") {
				await runtimeProvider.stopWorkspace(workspace.id);
				recordAuditEvent(storage, {
					actor,
					action: "container.stop",
					target: { kind: "workspace", id: workspace.id },
				});
				return jsonResponse({
					ok: true,
					action: "stop-containers",
					workspaceId: workspace.id,
					detail: "All containers stopped.",
				} satisfies AdminActionResponse);
			}

			if (action === "backup") {
				const projectDir = workspace.project_path;
				try {
					const s = await stat(projectDir);
					if (!s.isDirectory()) {
						return jsonResponse(
							{ error: "Project directory does not exist." },
							{ status: 404 },
						);
					}
				} catch {
					return jsonResponse(
						{ error: "Project directory does not exist." },
						{ status: 404 },
					);
				}
				const now = new Date();
				const pad = (n: number) => String(n).padStart(2, "0");
				const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
				const backupRoot = resolve(storage.config.dataDir, "backups", ts);
				const workspaceBackupDir = resolve(backupRoot, workspace.id);
				const dest = resolve(workspaceBackupDir, "project.tar.gz");
				await mkdir(workspaceBackupDir, { recursive: true });
				await createProjectArchive(projectDir, dest);
				recordAuditEvent(storage, {
					actor,
					action: "workspace.backup",
					target: { kind: "workspace", id: workspace.id },
					metadata: { dest },
				});
				return jsonResponse({
					ok: true,
					action: "backup",
					workspaceId: workspace.id,
					detail: `Backed up to ${dest}`,
				} satisfies AdminActionResponse);
			}

			if (action === "restore") {
				let body: { path?: string };
				try {
					body = (await request.json()) as { path?: string };
				} catch {
					return jsonResponse(
						{ error: "Request body must be valid JSON." },
						{ status: 400 },
					);
				}
				if (typeof body.path !== "string" || body.path.trim().length === 0) {
					return jsonResponse(
						{ error: "Missing or empty 'path' in request body." },
						{ status: 400 },
					);
				}
				const backupsRoot = resolve(storage.config.dataDir, "backups");
				const sourcePath = resolve(body.path);
				if (!isInsideDirectory(backupsRoot, sourcePath)) {
					return jsonResponse(
						{ error: "Restore path must be under data/backups/." },
						{ status: 403 },
					);
				}
				try {
					const s = await stat(sourcePath);
					if (!s.isFile()) {
						return jsonResponse(
							{ error: "Restore source is not a file." },
							{ status: 404 },
						);
					}
				} catch {
					return jsonResponse(
						{ error: "Restore source not found." },
						{ status: 404 },
					);
				}
				const projectDir = workspace.project_path;
				await mkdir(dirname(projectDir), { recursive: true });
				await restoreProjectArchive(projectDir, sourcePath);
				recordAuditEvent(storage, {
					actor,
					action: "workspace.restore",
					target: { kind: "workspace", id: workspace.id },
					metadata: { source: sourcePath },
				});
				return jsonResponse({
					ok: true,
					action: "restore",
					workspaceId: workspace.id,
					detail: `Restored from ${sourcePath}`,
				} satisfies AdminActionResponse);
			}
		} catch (error) {
			return apiErrorResponse(error, `Admin action ${action} failed.`);
		}
	}

	// --- User management endpoints ---
	if (url.pathname === "/admin/users" && request.method === "GET") {
		const users = storage.db
			.query(
				`
        SELECT
          u.id, u.name, u.email, u.role, u.slug, u.createdAt, u.updatedAt,
          w.id AS workspaceId, w.last_accessed_at AS lastSeenAt
        FROM user u
        LEFT JOIN workspaces w ON w.user_id = u.id
        ORDER BY u.name
      `,
			)
			.all() as Array<{
			id: string;
			name: string;
			email: string;
			role: string | null;
			slug: string | null;
			createdAt: string;
			updatedAt: string;
			workspaceId: string | null;
			lastSeenAt: string | null;
		}>;
		return jsonResponse({ ok: true, users });
	}

	const userActionMatch = /^\/admin\/users\/([^/]+)\/(promote|demote)$/.exec(
		url.pathname,
	);
	if (userActionMatch && request.method === "POST") {
		const userId = userActionMatch[1] ?? "";
		const action = userActionMatch[2] as "promote" | "demote";
		const user = storage.db
			.query("SELECT id, name, email, role FROM user WHERE id = ?")
			.get(userId) as {
			id: string;
			name: string;
			email: string;
			role: string | null;
		} | null;
		if (!user) {
			return jsonResponse({ error: "User not found." }, { status: 404 });
		}
		const newRole = action === "promote" ? "admin" : "student";
		if (action === "demote" && user.role === "admin") {
			const adminCount = storage.db
				.query("SELECT COUNT(*) AS count FROM user WHERE role = 'admin'")
				.get() as { count: number };
			if (adminCount.count <= 1) {
				return jsonResponse(
					{ error: "Cannot demote the last admin user." },
					{ status: 409 },
				);
			}
		}
		storage.db
			.query("UPDATE user SET role = ?, updatedAt = ? WHERE id = ?")
			.run(newRole, new Date().toISOString(), userId);
		recordAuditEvent(storage, {
			actor: auditActor(adminResult),
			action: action === "promote" ? "user.promote" : "user.demote",
			target: { kind: "user", id: userId },
			metadata: { email: user.email, newRole },
		});
		return jsonResponse({ ok: true, userId, role: newRole });
	}

	const userDeleteMatch = /^\/admin\/users\/([^/]+)$/.exec(url.pathname);
	if (userDeleteMatch && request.method === "DELETE") {
		const userId = userDeleteMatch[1] ?? "";
		const user = storage.db
			.query("SELECT id, name, email, role FROM user WHERE id = ?")
			.get(userId) as {
			id: string;
			name: string;
			email: string;
			role: string | null;
		} | null;
		if (!user) {
			return jsonResponse({ error: "User not found." }, { status: 404 });
		}
		if (user.role === "admin") {
			const adminCount = storage.db
				.query("SELECT COUNT(*) AS count FROM user WHERE role = 'admin'")
				.get() as { count: number };
			if (adminCount.count <= 1) {
				return jsonResponse(
					{ error: "Cannot delete the last admin user." },
					{ status: 409 },
				);
			}
		}

		const workspace = storage.findWorkspaceByUserId(userId);
		if (workspace) {
			runs.stopWorkspace(workspace.id);
			await runtimeProvider.stopWorkspace(workspace.id);
			await runtimeProvider.removeWorkspace(workspace.id);
		}

		storage.db.exec("BEGIN");
		try {
			if (workspace) {
				storage.db
					.query("DELETE FROM run_jobs WHERE workspace_id = ?")
					.run(workspace.id);
				storage.db
					.query("DELETE FROM container_leases WHERE workspace_id = ?")
					.run(workspace.id);
				storage.db
					.query("DELETE FROM workspaces WHERE id = ?")
					.run(workspace.id);
			}
			storage.db.query("DELETE FROM session WHERE userId = ?").run(userId);
			storage.db.query("DELETE FROM account WHERE userId = ?").run(userId);
			storage.db.query("DELETE FROM user WHERE id = ?").run(userId);
			storage.db.exec("COMMIT");
		} catch (error) {
			storage.db.exec("ROLLBACK");
			throw error;
		}

		if (workspace) {
			await rm(dirname(workspace.project_path), {
				recursive: true,
				force: true,
			});
		}

		recordAuditEvent(storage, {
			actor: auditActor(adminResult),
			action: "user.delete",
			target: { kind: "user", id: userId },
			metadata: { email: user.email },
		});

		return jsonResponse({ ok: true, userId });
	}

	// --- Allowlist endpoints ---
	if (url.pathname === "/admin/allowlist" && request.method === "GET") {
		const { getAllowlist } = await import("../auth/allowlist");
		return jsonResponse({ ok: true, ...getAllowlist() });
	}

	if (url.pathname === "/admin/allowlist" && request.method === "POST") {
		const { addAllowlistEntry } = await import("../auth/allowlist");
		let body: { kind?: string; value?: string };
		try {
			body = (await request.json()) as { kind?: string; value?: string };
		} catch {
			return jsonResponse({ error: "Invalid JSON body." }, { status: 400 });
		}
		if (body.kind !== "email" && body.kind !== "domain") {
			return jsonResponse(
				{ error: "kind must be 'email' or 'domain'." },
				{ status: 400 },
			);
		}
		if (typeof body.value !== "string" || !body.value.trim()) {
			return jsonResponse({ error: "value is required." }, { status: 400 });
		}
		const result = await addAllowlistEntry(body.kind, body.value);
		recordAuditEvent(storage, {
			actor: auditActor(adminResult),
			action: "allowlist.add",
			target: { kind: "allowlist", id: body.value },
			metadata: { kind: body.kind },
		});
		return jsonResponse({ ok: true, ...result });
	}

	const allowlistDeleteMatch = /^\/admin\/allowlist\/(.+)$/.exec(url.pathname);
	if (allowlistDeleteMatch && request.method === "DELETE") {
		const { removeAllowlistEntry, getAllowlist } = await import(
			"../auth/allowlist"
		);
		const value = decodeURIComponent(allowlistDeleteMatch[1] ?? "");
		const current = getAllowlist();
		const kind = current.emails.includes(value.toLowerCase())
			? "email"
			: "domain";
		await removeAllowlistEntry(kind, value);
		recordAuditEvent(storage, {
			actor: auditActor(adminResult),
			action: "allowlist.remove",
			target: { kind: "allowlist", id: value },
			metadata: { kind },
		});
		const updated = getAllowlist();
		return jsonResponse({ ok: true, ...updated });
	}

	// --- Allowlist reload ---
	if (url.pathname === "/admin/allowlist/reload" && request.method === "POST") {
		const { reloadAllowlist } = await import("../auth/allowlist");
		try {
			const result = await reloadAllowlist();
			return jsonResponse({ ok: true, ...result });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return jsonResponse({ ok: false, error: message }, { status: 400 });
		}
	}

	// --- Capacity cap runtime override ---
	if (
		url.pathname === "/admin/config/max-active-containers" &&
		request.method === "POST"
	) {
		let body: { value?: unknown };
		try {
			body = (await request.json()) as { value?: unknown };
		} catch {
			return jsonResponse({ error: "Invalid JSON body." }, { status: 400 });
		}
		const value = Number(body.value);
		if (!Number.isInteger(value) || value < 1) {
			return jsonResponse(
				{ error: "value must be a positive integer." },
				{ status: 400 },
			);
		}
		storage.setRuntimeConfig("max_active_containers", String(value));
		const actor = auditActor(adminResult);
		recordAuditEvent(storage, {
			actor,
			action: "config.max-active-containers",
			metadata: { value },
		});
		return jsonResponse({ ok: true, maxActiveContainers: value });
	}

	if (
		url.pathname === "/admin/config/max-active-containers" &&
		request.method === "GET"
	) {
		return jsonResponse({
			ok: true,
			maxActiveContainers: storage.getEffectiveMaxActiveContainers(),
			configDefault: storage.config.maxActiveContainers,
		});
	}

	// --- Audit log ---
	if (url.pathname === "/admin/audit-log" && request.method === "GET") {
		const limit = Number(url.searchParams.get("limit") ?? "100");
		const before = url.searchParams.get("before")
			? Number(url.searchParams.get("before"))
			: undefined;
		const actorEmail = url.searchParams.get("actor") ?? undefined;
		const actionPrefix = url.searchParams.get("action") ?? undefined;
		const days = url.searchParams.get("days")
			? Number(url.searchParams.get("days"))
			: undefined;
		const sinceMs = days ? Date.now() - days * 86_400_000 : undefined;
		const entries = queryAuditLog(storage, {
			limit,
			before,
			actorEmail,
			actionPrefix,
			sinceMs,
		});
		return jsonResponse({ ok: true, entries });
	}

	return notFound();
}
