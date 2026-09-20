import { describe, expect, test } from "bun:test";
import { summarizeJUnitXml } from "./test-results";

describe("summarizeJUnitXml", () => {
	test("counts passed, failed, errored, and skipped test cases", () => {
		expect(
			summarizeJUnitXml([
				'<testsuite tests="4" failures="1" errors="0" skipped="1" />',
				'<testsuite tests="3" failures="0" errors="1" skipped="0" />',
			]),
		).toEqual({ total: 7, passed: 4, failed: 2, skipped: 1 });
	});

	test("treats an absent report as a zero-test result", () => {
		expect(summarizeJUnitXml([])).toEqual({
			total: 0,
			passed: 0,
			failed: 0,
			skipped: 0,
		});
	});
});
