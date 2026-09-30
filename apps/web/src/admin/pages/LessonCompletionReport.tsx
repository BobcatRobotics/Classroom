import {
	Check,
	ChevronDown,
	ChevronsUpDown,
	ChevronUp,
	Download,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type ReportUser = { id: string; name: string; slug: string | null };
type ReportLesson = { module_id: string; lesson_title: string };
type ReportOptions = { users: ReportUser[]; lessons: ReportLesson[] };
type CompletionRow = {
	run_job_id: string;
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
	log_url: string | null;
};
type ReportResponse = {
	rows: CompletionRow[];
	total: number;
	page: number;
	pageSize: number;
};
type SortKey =
	| "user_name"
	| "user_slug"
	| "lesson_title"
	| "completed_at"
	| "build_succeeded"
	| "test_passed"
	| "tests_total"
	| "tests_passed"
	| "tests_failed"
	| "tests_skipped"
	| "log_path";
type ReportQuery = {
	studentId: string;
	moduleId: string;
	from: string;
	to: string;
	latest: boolean;
	page: number;
	pageSize: number;
	sort: SortKey;
	direction: "asc" | "desc";
};

function makeReportUrl(query: ReportQuery, format?: "csv"): string {
	const params = new URLSearchParams();
	if (query.studentId) params.set("studentId", query.studentId);
	if (query.moduleId) params.set("moduleId", query.moduleId);
	if (query.from) params.set("from", query.from);
	if (query.to) params.set("to", query.to);
	if (query.latest) params.set("latest", "true");
	params.set("page", String(query.page));
	params.set("pageSize", String(query.pageSize));
	params.set("sort", query.sort);
	params.set("direction", query.direction);
	if (format) params.set("format", format);
	return `/admin/lesson-completions?${params}`;
}

async function fetchReport(url: string): Promise<ReportResponse> {
	const response = await fetch(url, { credentials: "same-origin" });
	if (!response.ok)
		throw new Error(`${response.status} ${response.statusText}`);
	return response.json();
}

export function LessonCompletionReport() {
	const [options, setOptions] = useState<ReportOptions | null>(null);
	const [optionsLoading, setOptionsLoading] = useState(false);
	const [optionsError, setOptionsError] = useState<string | null>(null);
	const [studentId, setStudentId] = useState("");
	const [moduleId, setModuleId] = useState("");
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const [latest, setLatest] = useState(false);
	const [query, setQuery] = useState<ReportQuery | null>(null);
	const [report, setReport] = useState<ReportResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	function loadOptions() {
		if (options || optionsLoading) return;
		setOptionsLoading(true);
		setOptionsError(null);
		fetch("/admin/lesson-completions/options", { credentials: "same-origin" })
			.then(async (response) => {
				if (!response.ok)
					throw new Error(`${response.status} ${response.statusText}`);
				return (await response.json()) as ReportOptions;
			})
			.then(setOptions)
			.catch((cause: unknown) => {
				setOptionsError(
					cause instanceof Error ? cause.message : "Unable to load filters.",
				);
			})
			.finally(() => {
				setOptionsLoading(false);
			});
	}

	useEffect(() => {
		if (!query) return;
		let active = true;
		setLoading(true);
		setError(null);
		fetchReport(makeReportUrl(query))
			.then((data) => {
				if (active) setReport(data);
			})
			.catch((cause: unknown) => {
				if (active)
					setError(
						cause instanceof Error
							? cause.message
							: "Unable to generate report.",
					);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [query]);

	function generateReport() {
		setReport(null);
		setQuery({
			studentId,
			moduleId,
			from,
			to,
			latest,
			page: 1,
			pageSize: report?.pageSize ?? 20,
			sort: query?.sort ?? "completed_at",
			direction: query?.direction ?? "asc",
		});
	}

	function sortBy(sort: SortKey) {
		setQuery((current) =>
			current
				? {
						...current,
						page: 1,
						sort,
						direction:
							current.sort === sort && current.direction === "asc"
								? "desc"
								: "asc",
					}
				: current,
		);
	}

	const pageCount = report
		? Math.max(1, Math.ceil(report.total / report.pageSize))
		: 1;
	const firstRow =
		report && report.total > 0 ? (report.page - 1) * report.pageSize + 1 : 0;
	const lastRow = report
		? Math.min(report.page * report.pageSize, report.total)
		: 0;

	return (
		<div className="space-y-5">
			<div>
				<h2 className="text-xl font-semibold">Lesson Completion Report</h2>
			</div>

			<section
				className="space-y-4 border-b border-zinc-800 pb-5"
				aria-label="Report filters"
			>
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<label className="grid gap-1.5 text-sm">
						<span className="text-muted-foreground">User Name (slug)</span>
						<select
							className="h-9 rounded border border-zinc-700 bg-zinc-900 px-2"
							value={studentId}
							onFocus={loadOptions}
							onChange={(event) => setStudentId(event.target.value)}
						>
							<option value="">All users</option>
							{options?.users.map((user) => (
								<option key={user.id} value={user.id}>
									{user.name}
									{user.slug ? ` (${user.slug})` : ""}
								</option>
							))}
						</select>
					</label>
					<label className="grid gap-1.5 text-sm">
						<span className="text-muted-foreground">Lesson Title</span>
						<select
							className="h-9 rounded border border-zinc-700 bg-zinc-900 px-2"
							value={moduleId}
							onFocus={loadOptions}
							onChange={(event) => setModuleId(event.target.value)}
						>
							<option value="">All lessons</option>
							{options?.lessons.map((lesson) => (
								<option key={lesson.module_id} value={lesson.module_id}>
									{lesson.lesson_title}
								</option>
							))}
						</select>
					</label>
					<label className="grid gap-1.5 text-sm">
						<span className="text-muted-foreground">Completed from</span>
						<input
							className="h-9 rounded border border-zinc-700 bg-zinc-900 px-2"
							type="date"
							value={from}
							onChange={(event) => setFrom(event.target.value)}
						/>
					</label>
					<label className="grid gap-1.5 text-sm">
						<span className="text-muted-foreground">Completed to</span>
						<input
							className="h-9 rounded border border-zinc-700 bg-zinc-900 px-2"
							type="date"
							value={to}
							onChange={(event) => setTo(event.target.value)}
						/>
					</label>
				</div>
				<div className="flex flex-wrap items-center gap-4">
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={latest}
							onChange={(event) => setLatest(event.target.checked)}
						/>
						Show only latest completion per student and lesson
					</label>
					<Button onClick={generateReport} disabled={loading}>
						Generate report
					</Button>
					{optionsLoading && (
						<span className="text-sm text-muted-foreground">
							Loading filter options…
						</span>
					)}
					{optionsError && (
						<span className="text-sm text-destructive">
							Filter load failed: {optionsError}. Focus a dropdown to retry.
						</span>
					)}
					{from && to && from > to && (
						<span className="text-sm text-destructive">
							Start date must be on or before end date.
						</span>
					)}
				</div>
			</section>

			{error && (
				<p className="text-sm text-destructive">Report failed: {error}</p>
			)}
			{loading && (
				<p className="text-sm text-muted-foreground">Loading report…</p>
			)}

			{report && query && (
				<section className="space-y-3" aria-label="Lesson completion results">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="text-sm text-muted-foreground">
							{report.total.toLocaleString()} completions
						</p>
						<div className="flex items-center gap-3">
							<label className="flex items-center gap-2 text-sm text-muted-foreground">
								Rows
								<select
									className="h-8 rounded border border-zinc-700 bg-zinc-900 px-2 text-foreground"
									value={query.pageSize}
									onChange={(event) =>
										setQuery({
											...query,
											page: 1,
											pageSize: Number(event.target.value),
										})
									}
								>
									<option value={20}>20</option>
									<option value={50}>50</option>
									<option value={100}>100</option>
								</select>
							</label>
							<Button
								variant="outline"
								size="sm"
								onClick={() =>
									window.location.assign(makeReportUrl(query, "csv"))
								}
							>
								<Download /> Export CSV
							</Button>
						</div>
					</div>
					<div className="overflow-x-auto border border-zinc-800">
						<table className="w-full min-w-[1100px] text-left text-sm">
							<thead className="bg-zinc-900 text-muted-foreground">
								<tr>
									<SortHeader
										label="User Name"
										sort="user_name"
										active={query.sort}
										direction={query.direction}
										onSort={sortBy}
									/>
									<SortHeader
										label="User Slug"
										sort="user_slug"
										active={query.sort}
										direction={query.direction}
										onSort={sortBy}
									/>
									<SortHeader
										label="Lesson Title"
										sort="lesson_title"
										active={query.sort}
										direction={query.direction}
										onSort={sortBy}
									/>
									<SortHeader
										label="Completed At"
										sort="completed_at"
										active={query.sort}
										direction={query.direction}
										onSort={sortBy}
									/>
									<SortHeader
										label="Build"
										sort="build_succeeded"
										active={query.sort}
										direction={query.direction}
										onSort={sortBy}
									/>
									<SortHeader
										label="Tests Passed"
										sort="test_passed"
										active={query.sort}
										direction={query.direction}
										onSort={sortBy}
									/>
									<SortHeader
										label="Test Total"
										sort="tests_total"
										active={query.sort}
										direction={query.direction}
										onSort={sortBy}
									/>
									<SortHeader
										label="Passed"
										sort="tests_passed"
										active={query.sort}
										direction={query.direction}
										onSort={sortBy}
									/>
									<SortHeader
										label="Failed"
										sort="tests_failed"
										active={query.sort}
										direction={query.direction}
										onSort={sortBy}
									/>
									<SortHeader
										label="Skipped"
										sort="tests_skipped"
										active={query.sort}
										direction={query.direction}
										onSort={sortBy}
									/>
									<SortHeader
										label="Log Path"
										sort="log_path"
										active={query.sort}
										direction={query.direction}
										onSort={sortBy}
									/>
								</tr>
							</thead>
							<tbody>
								{report.rows.map((row) => (
									<tr key={row.run_job_id} className="border-t border-zinc-800">
										<td className="px-3 py-2">{row.user_name}</td>
										<td className="px-3 py-2 font-mono text-xs">
											{row.user_slug ?? "—"}
										</td>
										<td className="px-3 py-2">{row.lesson_title}</td>
										<td className="whitespace-nowrap px-3 py-2">
											{new Date(row.completed_at).toLocaleString()}
										</td>
										<td className="px-3 py-2">
											<Status value={row.build_succeeded} />
										</td>
										<td className="px-3 py-2">
											<Status value={row.test_passed} />
										</td>
										<td className="px-3 py-2">{row.tests_total}</td>
										<td className="px-3 py-2">{row.tests_passed}</td>
										<td className="px-3 py-2">{row.tests_failed}</td>
										<td className="px-3 py-2">{row.tests_skipped}</td>
										<td className="px-3 py-2">
											{row.log_url ? (
												<a
													className="text-sky-400 underline hover:text-sky-300"
													href={row.log_url}
													target="_blank"
													rel="noreferrer"
												>
													Open log
												</a>
											) : (
												"—"
											)}
										</td>
									</tr>
								))}
								{report.rows.length === 0 && (
									<tr>
										<td
											className="px-3 py-8 text-center text-muted-foreground"
											colSpan={11}
										>
											No lesson completions found.
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3 text-sm">
						<p className="text-muted-foreground">
							Showing {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of{" "}
							{report.total.toLocaleString()}
						</p>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={query.page <= 1 || loading}
								onClick={() => setQuery({ ...query, page: query.page - 1 })}
							>
								Previous
							</Button>
							<span className="tabular-nums">
								Page {query.page} of {pageCount}
							</span>
							<Button
								variant="outline"
								size="sm"
								disabled={query.page >= pageCount || loading}
								onClick={() => setQuery({ ...query, page: query.page + 1 })}
							>
								Next
							</Button>
						</div>
					</div>
				</section>
			)}
		</div>
	);
}

function SortHeader({
	label,
	sort,
	active,
	direction,
	onSort,
}: {
	label: string;
	sort: SortKey;
	active: SortKey;
	direction: "asc" | "desc";
	onSort: (sort: SortKey) => void;
}) {
	const Icon =
		active !== sort
			? ChevronsUpDown
			: direction === "asc"
				? ChevronUp
				: ChevronDown;
	return (
		<th className="whitespace-nowrap px-3 py-2 font-medium">
			<button
				className="inline-flex items-center gap-1 hover:text-foreground"
				type="button"
				onClick={() => onSort(sort)}
			>
				{label}
				<Icon aria-hidden="true" className="size-3.5" />
			</button>
		</th>
	);
}

function Status({ value }: { value: number }) {
	return value === 1 ? (
		<Check aria-label="Succeeded" className="size-4 text-green-500" />
	) : (
		<X aria-label="Failed" className="size-4 text-red-500" />
	);
}
