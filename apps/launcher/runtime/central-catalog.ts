import { launcherCatalogConfigResponseSchema } from "@frc-coderunner/contracts";

export async function configureCentralCatalog(
	environment: Record<string, string | undefined>,
	fetchImpl: typeof fetch = fetch,
): Promise<void> {
	const runtimeTicket = environment.FRC_LAUNCH_GRANT?.trim();
	const centralUrl = environment.CODERUNNER_CENTRAL_URL?.trim();
	if (!runtimeTicket || !centralUrl) {
		throw new Error("Sign in to CodeRunner before loading central lessons.");
	}

	let catalogConfigUrl: URL;
	try {
		catalogConfigUrl = new URL("/api/launcher/catalog-config", centralUrl);
	} catch {
		throw new Error("CodeRunner's central server URL is invalid.");
	}
	const isLoopbackHttp =
		catalogConfigUrl.protocol === "http:" &&
		["localhost", "127.0.0.1"].includes(catalogConfigUrl.hostname);
	if (
		(catalogConfigUrl.protocol !== "https:" && !isLoopbackHttp) ||
		catalogConfigUrl.username ||
		catalogConfigUrl.password
	) {
		throw new Error("CodeRunner sign-in requires a trusted HTTPS server URL.");
	}

	const response = await fetchImpl(catalogConfigUrl, {
		headers: { Authorization: `Bearer ${runtimeTicket}` },
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) {
		throw new Error(
			"CodeRunner could not load the central lesson catalog. Sign in again and retry.",
		);
	}
	const config = launcherCatalogConfigResponseSchema.parse(
		await response.json(),
	);
	if (config.catalogRepo && config.catalogBranch) {
		environment.LESSONS_CATALOG_REPO = config.catalogRepo;
		environment.LESSONS_CATALOG_BRANCH = config.catalogBranch;
	} else {
		delete environment.LESSONS_CATALOG_REPO;
		delete environment.LESSONS_CATALOG_BRANCH;
	}
}
