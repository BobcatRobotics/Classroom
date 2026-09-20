import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type TestResults = {
	total: number;
	passed: number;
	failed: number;
	skipped: number;
};

const EMPTY_RESULTS: TestResults = {
	total: 0,
	passed: 0,
	failed: 0,
	skipped: 0,
};

function attribute(xml: string, name: string): number {
	const match = new RegExp(`\\b${name}="(\\d+)"`, "u").exec(xml);
	return match ? Number(match[1]) : 0;
}

/** Summarize Gradle's JUnit XML suite reports without trusting presentation HTML. */
export function summarizeJUnitXml(documents: string[]): TestResults {
	return documents.reduce<TestResults>((results, document) => {
		const suite = /<testsuite\b[^>]*>/u.exec(document)?.[0];
		if (!suite) return results;
		const total = attribute(suite, "tests");
		const failed = attribute(suite, "failures") + attribute(suite, "errors");
		const skipped = attribute(suite, "skipped");
		return {
			total: results.total + total,
			failed: results.failed + failed,
			skipped: results.skipped + skipped,
			passed: results.passed + Math.max(0, total - failed - skipped),
		};
	}, EMPTY_RESULTS);
}

export async function readGradleTestResults(
	projectPath: string,
): Promise<TestResults> {
	const reportsPath = join(projectPath, "build", "test-results", "test");
	const entries = await readdir(reportsPath, { withFileTypes: true }).catch(
		() => [],
	);
	const documents = await Promise.all(
		entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".xml"))
			.map((entry) => readFile(join(reportsPath, entry.name), "utf8")),
	);
	return summarizeJUnitXml(documents);
}
