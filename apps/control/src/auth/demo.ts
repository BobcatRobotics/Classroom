/**
 * Demo mode helpers — single seeded admin user + synthetic session.
 *
 * Used by `bun run start -- --demo` (or CODERUNNER_DEMO_MODE=1) to let
 * someone evaluate CodeRunner without configuring OAuth or an allowlist.
 *
 * Not safe to expose publicly: every request resolves to the same user,
 * so there is no privacy boundary between concurrent visitors.
 */

import type { LocalUserIdentity } from "@frc-coderunner/contracts";
import type { AppStorage } from "../storage";

export const DEMO_USER_ID = "demo_admin_local_user";
export const DEMO_SLUG = "demo";
export const DEMO_EMAIL = "demo@local";
export const DEMO_NAME = "Demo";

/** Synthetic session payload returned by getSessionFromRequest in demo mode. */
export function getDemoSession(identity: LocalUserIdentity | null = null) {
	const name = identity?.displayName ?? DEMO_NAME;
	const email = identity?.email ?? DEMO_EMAIL;
	const image = identity?.avatarUrl ?? null;
	const role = identity?.role ?? "admin";
	return {
		user: {
			id: DEMO_USER_ID,
			email,
			name,
			image,
			role,
			slug: DEMO_SLUG,
		},
		session: {
			token: identity ? "local-central-session" : "demo-synthetic-session",
		},
	};
}

/** Session shape that Better Auth's /api/auth/session endpoint returns. */
export function getDemoSessionResponseBody(
	identity: LocalUserIdentity | null = null,
) {
	const now = new Date();
	const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
	const session = getDemoSession(identity);
	return {
		user: {
			id: session.user.id,
			email: session.user.email,
			emailVerified: true,
			name: session.user.name,
			image: session.user.image,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
			role: session.user.role,
			slug: session.user.slug,
		},
		session: {
			id: session.session.token,
			token: session.session.token,
			userId: DEMO_USER_ID,
			expiresAt: expires.toISOString(),
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		},
	};
}

/**
 * Idempotently insert the demo user row and ensure its workspace exists.
 * Safe to call on every boot.
 */
export async function seedDemoUser(
	storage: AppStorage,
	identity: LocalUserIdentity | null = null,
): Promise<void> {
	const name = identity?.displayName ?? DEMO_NAME;
	const email = identity?.email ?? DEMO_EMAIL;
	const image = identity?.avatarUrl ?? null;
	const role = identity?.role ?? "admin";
	const now = new Date().toISOString();
	storage.db
		.query(
			`INSERT OR IGNORE INTO user (id, name, email, emailVerified, image, createdAt, updatedAt, role, slug)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(DEMO_USER_ID, name, email, 1, image, now, now, role, DEMO_SLUG);

	storage.db
		.query(
			"UPDATE user SET name = ?, email = ?, emailVerified = 1, image = ?, role = ?, slug = ?, updatedAt = ? WHERE id = ?",
		)
		.run(name, email, image, role, DEMO_SLUG, now, DEMO_USER_ID);

	await storage.ensureWorkspaceForUser(DEMO_USER_ID, DEMO_SLUG);
}
