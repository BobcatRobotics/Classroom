/**
 * Property tests for `parseGitHubUrl` (repo-root-only after Decision 029).
 *
 * P1 — for any string input, the validator either returns a normalized URL
 *      or rejects with a typed error. Never throws an unexpected error type.
 * P2 — idempotence: any accepted URL re-validates to the same accepted form.
 * P3 — URLs with non-HTTPS scheme, non-github host, or extra path segments
 *      (tree/branch/subdir) are rejected.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { ImportError, parseGitHubUrl } from "../../imports";

const NUM_RUNS = Number(process.env.FAST_CHECK_NUM_RUNS ?? 200);

describe("parseGitHubUrl — properties", () => {
	test("P1 never throws non-ImportError", () => {
		fc.assert(
			fc.property(fc.string(), (raw) => {
				try {
					parseGitHubUrl(raw);
				} catch (err) {
					if (!(err instanceof ImportError)) {
						throw new Error(
							`unexpected error type: ${(err as Error)?.constructor?.name}: ${String(err)}`,
						);
					}
				}
			}),
			{ numRuns: NUM_RUNS },
		);
	});

	test("P2 idempotence: parsed cloneUrl re-parses to the same cloneUrl", () => {
		fc.assert(
			fc.property(
				fc
					.tuple(
						fc.stringMatching(/^[A-Za-z0-9_.-]{1,20}$/),
						fc.stringMatching(/^[A-Za-z0-9_.-]{1,20}$/),
					)
					.filter(
						([owner, repo]) => !owner.startsWith(".") && !repo.startsWith("."),
					),
				([owner, repo]) => {
					const url = `https://github.com/${owner}/${repo}`;
					const first = parseGitHubUrl(url);
					const second = parseGitHubUrl(first.cloneUrl);
					expect(second.cloneUrl).toBe(first.cloneUrl);
				},
			),
			{ numRuns: NUM_RUNS },
		);
	});

	test("P3 rejects non-HTTPS schemes", () => {
		fc.assert(
			fc.property(
				fc.constantFrom("http", "ftp", "file", "javascript", "data"),
				(scheme) => {
					expect(() => parseGitHubUrl(`${scheme}://github.com/o/r`)).toThrow();
				},
			),
			{ numRuns: 50 },
		);
	});

	test("P3 rejects non-github hosts even with looks-like-github path", () => {
		fc.assert(
			fc.property(
				fc.constantFrom(
					"gitlab.com",
					"evil.com",
					"github.com.evil.com",
					"127.0.0.1",
					"localhost",
				),
				(host) => {
					try {
						parseGitHubUrl(`https://${host}/owner/repo`);
						throw new Error(`accepted bad host: ${host}`);
					} catch (err) {
						expect(err).toBeInstanceOf(ImportError);
					}
				},
			),
			{ numRuns: 50 },
		);
	});

	test("P3 rejects tree/branch/subdir and extra-segment forms", () => {
		fc.assert(
			fc.property(
				fc.constantFrom(
					"https://github.com/o/r/tree/main/sub",
					"https://github.com/o/r/tree/main",
					"https://github.com/o/r/a/b",
					"https://github.com/o/r/pulls",
				),
				(url) => {
					expect(() => parseGitHubUrl(url)).toThrow(ImportError);
				},
			),
			{ numRuns: 20 },
		);
	});
});
