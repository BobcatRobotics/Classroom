import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { launcherIdentitySchema } from "@frc-coderunner/contracts";
import { getSessionFromRequest } from "../auth/middleware";
import type { AppStorage } from "../storage";
import { jsonResponse } from "./responses";

const CODE_TTL_MS = 2 * 60 * 1000;
const BASE64URL_32_BYTE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

function sha256Base64Url(value: string): string {
	return createHash("sha256").update(value).digest("base64url");
}

function validLoopbackCallback(value: string | null): URL | null {
	if (!value) return null;
	try {
		const callback = new URL(value);
		const port = Number(callback.port);
		if (
			callback.protocol !== "http:" ||
			callback.hostname !== "127.0.0.1" ||
			!Number.isInteger(port) ||
			port < 1 ||
			port > 65535 ||
			callback.pathname !== "/callback" ||
			callback.username ||
			callback.password ||
			callback.search ||
			callback.hash
		) {
			return null;
		}
		return callback;
	} catch {
		return null;
	}
}

function invalidCode(): Response {
	return jsonResponse(
		{ error: "Authorization code is invalid, expired, or already used." },
		{ status: 400, headers: { "Cache-Control": "no-store" } },
	);
}

function invalidLaunchGrant(): Response {
	return jsonResponse(
		{ error: "Launch authorization is invalid or expired." },
		{ status: 401, headers: { "Cache-Control": "no-store" } },
	);
}

export async function handleLauncherAuthRoute(
	storage: AppStorage,
	url: URL,
	request: Request,
): Promise<Response | null> {
	if (url.pathname === "/launcher/authorize" && request.method === "GET") {
		const callback = validLoopbackCallback(
			url.searchParams.get("redirect_uri"),
		);
		const state = url.searchParams.get("state") ?? "";
		const codeChallenge = url.searchParams.get("code_challenge") ?? "";
		if (
			!callback ||
			!BASE64URL_32_BYTE_PATTERN.test(state) ||
			!BASE64URL_32_BYTE_PATTERN.test(codeChallenge)
		) {
			return jsonResponse(
				{ error: "Invalid launcher authorization request." },
				{
					status: 400,
					headers: { "Cache-Control": "no-store" },
				},
			);
		}
		if (!storage.config.githubClientId || !storage.config.githubClientSecret) {
			return jsonResponse(
				{
					error: "GitHub sign-in is not configured for this CodeRunner server.",
				},
				{ status: 503, headers: { "Cache-Control": "no-store" } },
			);
		}

		const session = await getSessionFromRequest(storage, request);
		const githubAccount = session
			? storage.db
					.query(
						"SELECT 1 FROM account WHERE userId = ? AND providerId = 'github' LIMIT 1",
					)
					.get(session.user.id)
			: null;
		if (!session || !githubAccount) {
			const returnTo = `${url.pathname}${url.search}`;
			return new Response(null, {
				status: 303,
				headers: {
					Location: `/login?returnTo=${encodeURIComponent(returnTo)}`,
					"Cache-Control": "no-store",
				},
			});
		}

		const code = randomBytes(32).toString("base64url");
		const now = Date.now();
		const expiresAt = new Date(now + CODE_TTL_MS).toISOString();
		storage.db
			.query("DELETE FROM launcher_auth_codes WHERE expires_at <= ?")
			.run(new Date(now).toISOString());
		storage.db
			.query("DELETE FROM launcher_runtime_grants WHERE expires_at <= ?")
			.run(new Date(now).toISOString());
		storage.db
			.query(
				"INSERT INTO launcher_auth_codes (code_hash, user_id, code_challenge, expires_at) VALUES (?, ?, ?, ?)",
			)
			.run(sha256Base64Url(code), session.user.id, codeChallenge, expiresAt);

		callback.searchParams.set("code", code);
		callback.searchParams.set("state", state);
		return new Response(null, {
			status: 303,
			headers: {
				Location: callback.toString(),
				"Cache-Control": "no-store",
			},
		});
	}

	if (url.pathname === "/api/launcher/exchange" && request.method === "POST") {
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return jsonResponse({ error: "Invalid JSON body." }, { status: 400 });
		}
		const code = (body as { code?: unknown } | null)?.code;
		const verifier = (body as { codeVerifier?: unknown } | null)?.codeVerifier;
		if (
			typeof code !== "string" ||
			!BASE64URL_32_BYTE_PATTERN.test(code) ||
			typeof verifier !== "string" ||
			verifier.length < 43 ||
			verifier.length > 128 ||
			!/^[A-Za-z0-9._~-]+$/u.test(verifier)
		) {
			return invalidCode();
		}

		const codeHash = sha256Base64Url(code);
		const record = storage.db
			.query(
				"SELECT user_id, code_challenge, expires_at, consumed_at FROM launcher_auth_codes WHERE code_hash = ?",
			)
			.get(codeHash) as {
			user_id: string;
			code_challenge: string;
			expires_at: string;
			consumed_at: string | null;
		} | null;
		if (
			!record ||
			record.consumed_at ||
			record.expires_at <= new Date().toISOString()
		) {
			return invalidCode();
		}
		const suppliedChallenge = Buffer.from(sha256Base64Url(verifier));
		const expectedChallenge = Buffer.from(record.code_challenge);
		if (
			suppliedChallenge.length !== expectedChallenge.length ||
			!timingSafeEqual(suppliedChallenge, expectedChallenge)
		) {
			return invalidCode();
		}

		const consumedAt = new Date().toISOString();
		const consumed = storage.db
			.query(
				"UPDATE launcher_auth_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?",
			)
			.run(consumedAt, codeHash, consumedAt);
		if (consumed.changes !== 1) return invalidCode();
		if (storage.isAccountDisabled(record.user_id)) {
			return jsonResponse(
				{ error: "This CodeRunner account has been disabled." },
				{
					status: 403,
					headers: { "Cache-Control": "no-store" },
				},
			);
		}
		const runtimeTicket = randomBytes(32).toString("base64url");
		const expiresAt = new Date(
			Date.now() + storage.config.desktopLaunchGrantTtlMs,
		).toISOString();
		storage.db
			.query(
				"INSERT INTO launcher_runtime_grants (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
			)
			.run(sha256Base64Url(runtimeTicket), record.user_id, expiresAt);
		return jsonResponse(
			{ ok: true, runtimeTicket },
			{ headers: { "Cache-Control": "no-store" } },
		);
	}

	if (
		url.pathname === "/api/launcher/validate-launch" &&
		request.method === "POST"
	) {
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return jsonResponse(
				{ error: "Launch authorization is invalid." },
				{ status: 401, headers: { "Cache-Control": "no-store" } },
			);
		}
		const runtimeTicket = (body as { runtimeTicket?: unknown } | null)
			?.runtimeTicket;
		if (
			typeof runtimeTicket !== "string" ||
			!BASE64URL_32_BYTE_PATTERN.test(runtimeTicket)
		) {
			return jsonResponse(
				{ error: "Launch authorization is invalid." },
				{
					status: 401,
					headers: { "Cache-Control": "no-store" },
				},
			);
		}
		const grant = storage.db
			.query(
				"SELECT user_id FROM launcher_runtime_grants WHERE token_hash = ? AND expires_at > ?",
			)
			.get(sha256Base64Url(runtimeTicket), new Date().toISOString()) as {
			user_id: string;
		} | null;
		if (!grant || storage.isAccountDisabled(grant.user_id)) {
			return jsonResponse(
				{ error: "Launch authorization is invalid or expired." },
				{
					status: 401,
					headers: { "Cache-Control": "no-store" },
				},
			);
		}
		const githubAccount = storage.db
			.query(
				"SELECT 1 FROM account WHERE userId = ? AND providerId = 'github' LIMIT 1",
			)
			.get(grant.user_id);
		if (!githubAccount) {
			return jsonResponse(
				{ error: "Launch authorization is invalid or expired." },
				{
					status: 401,
					headers: { "Cache-Control": "no-store" },
				},
			);
		}
		const user = storage.db
			.query("SELECT id, name, email, image, role FROM user WHERE id = ?")
			.get(grant.user_id) as {
			id: string;
			name: string;
			email: string;
			image: string | null;
			role: string | null;
		} | null;
		if (!user) return invalidLaunchGrant();
		const identity = launcherIdentitySchema.safeParse({
			userId: user.id,
			displayName: user.name,
			email: user.email,
			avatarUrl: user.image,
			role: user.role === "admin" ? "admin" : "student",
		});
		if (!identity.success) return invalidLaunchGrant();
		return jsonResponse(
			{ ok: true, identity: identity.data },
			{ headers: { "Cache-Control": "no-store" } },
		);
	}

	return null;
}
