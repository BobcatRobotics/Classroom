# Plan 003: Add baseline security response headers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report — do
> not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cb83908..HEAD -- apps/control/src/app.ts e2e/specs/security/response-headers.spec.ts`
> If either file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `cb83908`, 2026-06-11

## Why this matters

The control plane currently sets **no** baseline security response headers. The
React IDE shell, `/login`, the admin SPA, and the AdvantageScope `/scope` surface
are all served without `X-Content-Type-Options: nosniff` (MIME-sniffing),
`X-Frame-Options` (clickjacking of the Driver-Station / run controls), or
`Referrer-Policy`. The repo's own e2e spec documents these as expected-but-absent
and marks the assertions "informational." Adding conservative, broadly-safe
headers at the single response chokepoint gives defense-in-depth at near-zero
risk: a future output-encoding miss no longer trivially becomes clickjacking or a
content-type confusion attack.

**Scope discipline (important):** this plan deliberately adds only the
low-risk headers and uses `headers.has()` guards so it never clobbers headers the
proxied openvscode editor or AdvantageScope already set. A full
`Content-Security-Policy` is **out of scope** — the editor and AS Lite rely on
inline scripts / `eval`, so a real CSP needs its own careful, separately-tested
effort. See Maintenance notes.

## Current state

`apps/control/src/app.ts:164-224` — the `fetch` wrapper is the single point every
response passes through (it already centralizes metrics + logging). It calls
`dispatch(...)` and returns the response unmodified:

```ts
	async function fetch(
		request: Request,
		server?: BunUpgradeServer,
	): Promise<Response> {
		const url = new URL(request.url);
		const start = performance.now();
		const route = templateRoute(url.pathname);
		httpRequestsInFlight.inc();
		let response: Response;
		let observedStatus: number;
		try {
			response = await dispatch(request, server, url);
			observedStatus = response.status;
		} catch (err) {
			// ... metrics + rethrow ...
		}
		httpRequestsInFlight.dec();
		// ... duration metrics + logging ...
		return response;
	}
```

`apps/control/src/app/responses.ts` holds the first-party response builders
(`htmlResponse`, `jsonResponse`, `redirect`, etc.); `apps/control/src/app/assets.ts`
holds `webShellResponse`, `webAssetResponse`, `scopeResponse`.

Confirmed there is **no** security-header code today:
`grep -rni "content-security-policy\|x-frame-options\|x-content-type\|strict-transport\|nosniff\|frame-ancestors" apps/control/src` returns nothing.

The current e2e header spec (`e2e/specs/security/response-headers.spec.ts:41-53`)
is informational:

```ts
test("X-Content-Type-Options nosniff is present on text/* responses (when configured)", async ({
	app,
}) => {
	const baseUrl = app.storage.config.baseUrl;
	const resp = await app.fetch(new Request(`${baseUrl}/healthz`));
	const nosniff = resp.headers.get("x-content-type-options");
	// Note: as of now, the control plane may not set this header. ...
	if (nosniff !== null) {
		expect(nosniff).toMatch(/nosniff/i);
	}
});
```

### Why these specific headers / values

- `X-Content-Type-Options: nosniff` — always safe; the app sends correct
  `content-type` on every response.
- `X-Frame-Options: SAMEORIGIN` — the IDE shell **iframes its own** editor
  (`/u/:slug/vscode/*`) and AdvantageScope (`/scope`) from the **same origin**, so
  `SAMEORIGIN` is correct. **Do NOT use `DENY`** — it would break the same-origin
  iframes. Use `headers.has()` so we never overwrite a framing header the editor
  proxy already set.
- `Referrer-Policy: strict-origin-when-cross-origin` — safe default, no app impact.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` — only
  meaningful over HTTPS, harmless over plain HTTP (browsers ignore it on
  non-secure origins). Set only when not already present.

## Commands you will need

| Purpose   | Command                                          | Expected on success |
|-----------|--------------------------------------------------|---------------------|
| Typecheck | `bun run typecheck`                              | exit 0, no errors   |
| Control tests | `bun run test`                               | all pass            |
| E2E security  | `bun run e2e:security`                       | all pass            |
| Lint/format (write) | `bun run check:fix`                    | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `apps/control/src/app.ts` — add a `applySecurityHeaders` helper and call it in
  the `fetch` wrapper.
- `e2e/specs/security/response-headers.spec.ts` — flip the informational
  assertions to enforced and add an `X-Frame-Options` assertion.

**Out of scope** (do NOT touch):
- `apps/control/src/app/proxy.ts` and the editor proxy path — do not add headers
  there; the `headers.has()` guards in the central helper protect upstream
  headers, and the proxy forwards openvscode's own headers intentionally.
- **No Content-Security-Policy** in this plan (see Why / Maintenance).
- Cookie attributes (`HttpOnly`/`Secure`/`SameSite`) — owned by Better Auth; not
  this plan.

## Git workflow

- Branch: `advisor/003-security-headers`
- Commit per logical unit (helper, then e2e assertions) or one commit; message
  e.g. `security(http): set baseline nosniff/X-Frame-Options/Referrer-Policy/HSTS`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add an `applySecurityHeaders` helper in `app.ts`

Add a module-level helper near the other helpers in `apps/control/src/app.ts`
(e.g. just below `authorizeMetrics`, before `createApp`). It must mutate-and-return
the same `Response` (do not reconstruct the body — that would break streamed/file
responses), and must set each header only when absent:

```ts
function applySecurityHeaders(response: Response): Response {
	const headers = response.headers;
	if (!headers.has("x-content-type-options")) {
		headers.set("x-content-type-options", "nosniff");
	}
	if (!headers.has("x-frame-options")) {
		// SAMEORIGIN, not DENY: the IDE shell iframes its own same-origin editor
		// and AdvantageScope surfaces.
		headers.set("x-frame-options", "SAMEORIGIN");
	}
	if (!headers.has("referrer-policy")) {
		headers.set("referrer-policy", "strict-origin-when-cross-origin");
	}
	if (!headers.has("strict-transport-security")) {
		headers.set(
			"strict-transport-security",
			"max-age=31536000; includeSubDomains",
		);
	}
	return response;
}
```

Note: mutating `response.headers` in place is supported by Bun/undici `Response`
objects. If a particular response's headers turn out to be immutable (a thrown
`TypeError` on `.set`), that is a STOP condition — report it; do not switch to
reconstructing the body.

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Apply the helper at the single chokepoint in `fetch`

In the `fetch` function, wrap the response from `dispatch` so **every** returned
response gets the headers. The cleanest edit: change the success path so that
immediately after `response = await dispatch(request, server, url);` you do
`response = applySecurityHeaders(response);`. (Apply it once; the `return response;`
at the end then returns the decorated response. Do not also decorate the error
path — that rethrows.)

**Verify**: `bun run typecheck` → exit 0, and `bun run test` → all pass.

### Step 3: Promote the e2e header assertions from informational to enforced

In `e2e/specs/security/response-headers.spec.ts`, replace the
"(when configured)" nosniff test with an enforced version and add an
`X-Frame-Options` test. Model the assertion style on the existing tests in the
file:

```ts
test("X-Content-Type-Options nosniff is set on responses", async ({ app }) => {
	const baseUrl = app.storage.config.baseUrl;
	const resp = await app.fetch(new Request(`${baseUrl}/healthz`));
	expect(resp.headers.get("x-content-type-options")).toMatch(/nosniff/i);
});

test("X-Frame-Options is set to SAMEORIGIN on the web shell", async ({ app }) => {
	const baseUrl = app.storage.config.baseUrl;
	const resp = await app.fetch(new Request(`${baseUrl}/login`));
	expect(resp.headers.get("x-frame-options")).toMatch(/sameorigin/i);
});
```

Keep the existing cookie/healthz tests in the file unchanged.

**Verify**: `bun run e2e:security` → all pass (including the two updated/added
header tests).

### Step 4: Format and full control-plane test run

**Verify**: `bun run check:fix` → exit 0; `bun run test` → all pass.

## Test plan

- Update `e2e/specs/security/response-headers.spec.ts` (Step 3): nosniff now
  enforced; new `X-Frame-Options: SAMEORIGIN` assertion.
- Cases covered: nosniff present on a basic response (`/healthz`), framing header
  present and SAMEORIGIN on a first-party HTML route (`/login`).
- Structural pattern: the other tests already in
  `e2e/specs/security/response-headers.spec.ts` (same `{ app }` fixture,
  `app.fetch(new Request(...))`, `resp.headers.get(...)`).
- Verification: `bun run e2e:security` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun run test` exits 0
- [ ] `bun run e2e:security` exits 0, with nosniff + X-Frame-Options assertions enforced (no `if (x !== null)` guard remaining on the nosniff test)
- [ ] `grep -n "x-content-type-options" apps/control/src/app.ts` shows the header is set
- [ ] `grep -n "DENY" apps/control/src/app.ts` returns nothing (must be SAMEORIGIN, not DENY)
- [ ] `git status --porcelain` shows only `apps/control/src/app.ts` and `e2e/specs/security/response-headers.spec.ts` modified
- [ ] `plans/README.md` status row for 003 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Setting a header throws (immutable `Response.headers`) on any route — report the
  route; do not work around it by reconstructing response bodies.
- The proxied editor (openvscode) or AdvantageScope visibly breaks in the e2e run
  because a header was clobbered — the `headers.has()` guard should prevent this;
  if it happens, a header is being set somewhere other than the central helper.
- You find yourself needing to add a `Content-Security-Policy` to make a test
  pass — that is explicitly out of scope; stop and report.

## Maintenance notes

- **CSP is the deferred follow-up.** A real `Content-Security-Policy` (or
  `...-Report-Only` first) needs to enumerate what openvscode-server and
  AdvantageScope Lite require (`unsafe-inline`/`unsafe-eval`, worker/wasm sources,
  the NT4/HALSim WebSocket connect-src). Do that as a separate, e2e-gated effort;
  ship it Report-Only first and watch for violations before enforcing.
- **Related, not in this plan:** mutating HTTP routes
  (`/api/sim/run`, `/api/run`, `/api/project/import`, etc. in
  `app/workspace-routes.ts`) rely solely on SameSite=Lax for CSRF — they do not
  call `requireWebSocketOrigin` the way the WS routes do. Low severity today
  (JSON content-type + Lax blocks form CSRF), but if SameSite is ever loosened,
  add an Origin check to those routes mirroring `requireWebSocketOrigin`
  (`auth/middleware.ts:224`).
- Reviewer should confirm: helper applied exactly once at the chokepoint, all
  four headers guarded by `has()`, SAMEORIGIN (not DENY), and no CSP slipped in.
