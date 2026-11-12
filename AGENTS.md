# AGENTS.md — Outreach Desk

Standing instructions for any AI coding agent (Codex, etc.) working in this repository.
Read this before changing code. When a rule here conflicts with a request, follow the
rule and flag the conflict.

## 1. What this is
A **standalone, local Node 24 app** for researching companies and managing outbound
outreach worklists. Single-user, loopback-only by default (see §4.1 for the opt-in
exception). Vanilla-JS browser frontend, no framework, no build step.

**Dependencies:** Node built-ins plus exactly **one approved exception** — `pg`, used only
when `DATABASE_URL` selects the Neon/Postgres backend. The default SQLite path uses the
built-in `node:sqlite` and loads nothing external at runtime. Full rule in §5.

- Server + logic: `*.mjs` at the repo root.
- Browser code: `public/*.js` (ES modules loaded directly by the page).
- Data: `data/outreach.sqlite` by default (set `OUTREACH_DATA_DIR` to relocate; `PORT` to
  rebind). With `DATABASE_URL` set the same state document lives in the Neon `workspace_state`
  table instead — one document either way, see `db.mjs`.

## 2. Commands
- `npm start` — run the server on http://localhost:8282/ (Node 24+).
- `npm run check` — syntax-parse every module (`node --check`). Necessary, not sufficient.
- `npm test` — behaviour tests (`node --test`, auto-discovers `test/`).
- `npm run verify` — `check` + `test`. **Run this after every change and before declaring done.**

## 3. Architecture map (who owns what)
- `server.mjs` — HTTP layer only: routing, auth gate, request size limits, CSP/CSRF,
  optimistic-concurrency commits, the Jev one-record guard. No business rules here.
- `model.mjs` — the **reducer**. `perform(state, type, input)` is the *single* mutation
  path for `/api/action`. Also owns `createState`, `generate` (worklist builder),
  `runDaily`, `reconcileAssignments`, validation helpers, and PII `erase`.
- `public/eligibility.js` — shared handle/eligibility rules (`handleKey`, `isSuppressed`,
  `contactAllowed`). Imported by BOTH the browser and `model.mjs`. Keep it browser-safe:
  no Node-only APIs, no DOM-only APIs.
- `jev.mjs` — TypeSafe/Jev scoring client. `jevInput` (evidence + basis hash),
  `scoreWithJev` (call + validate + tier).
- `firecrawl.mjs`, `research-providers.mjs` — third-party research clients.
- `auth.mjs` — password hashing + in-memory sessions.
- `score-nordic.mjs`, `reset-password.mjs` — operator CLIs.
- `Jev_Scoring_Logic.md` — the authoritative tier/criteria spec. `jev.mjs` must match it.

## 4. Hard invariants — do not weaken these (tests enforce some)
1. **Loopback only, unless explicitly opted in.** Default: requests whose `Host` is not
   `127.0.0.1:<port>` or `localhost:<port>` must be rejected, and the server binds
   `127.0.0.1`. The single exception is the opt-in `OUTREACH_MODE=server`
   (`docs/SERVER-MODE.md`), which binds `0.0.0.0` and validates `Host` against
   `OUTREACH_ALLOWED_HOSTS`, failing closed when that list is empty. Server mode is **not**
   yet safe for public exposure — see `docs/SECURITY.md` §1.1. Never weaken the default path.
2. **CSRF + content-type.** Every mutating endpoint goes through `requirePost`: JSON
   `content-type` and an `Origin` that equals `<scheme>://<host>`, where the scheme is
   `http` locally and is taken from `X-Forwarded-Proto` (default `https`) in server mode.
3. **Response headers.** Keep the CSP (`default-src 'self'`, `script-src 'self'`,
   `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'self'`),
   `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
4. **Auth.** scrypt-hashed password (constant-time compare), min 10 chars. Session cookie
   stays `HttpOnly; SameSite=Strict; Path=/`. Do not move to token-in-URL or localStorage auth.
5. **Data minimisation / PII.** Before any evidence leaves the app to TypeSafe, emails are
   redacted (`jev.mjs` `clean`). `erase` requires the literal `ERASE` token and must wipe
   contacts, channels, notes, drafts, description, source, fitReview and jevFit.
6. **Jev one-record rule.** Exactly one lead per scoring request; reject arrays/batches;
   reject a second request while one is in flight; commit before scoring the next. Never
   convert an API failure into a low score. Tier math must match `Jev_Scoring_Logic.md`.
7. **Optimistic concurrency.** State is one JSON document with a `revision`. Writes must
   compare-and-swap on `revision` and return 409 on conflict. Do not drop the guard.
8. **Provider clients.** Keep `redirect:'error'`, an `AbortSignal.timeout`, the busy/lock
   guards, and the credit floors (Firecrawl 105-credit reserve; LimaData >=4 credits for
   `find/email_work`).
    Outcomes must be reviewed before saving; deliverability stays labelled unverified.
 9. **TLS verification and store choice are never left to the ambient environment.** Startup
    calls `enforceTlsVerification()` (`db.mjs`) before any provider or database connection, so an
    inherited `NODE_TLS_REJECT_UNAUTHORIZED=0` cannot silently disable certificate verification on
    requests carrying lead PII. Do not add a flag to re-disable it. The startup line names the
    active store, and `OUTREACH_REQUIRE_NEON=1` makes a missing `DATABASE_URL` fatal instead of
    falling back to a SQLite document that may be stale.

## 5. Coding conventions
- Match the existing compact style: no spaces inside `{}`/`()` for short helpers, arrow
  function helpers, `const` by default. Prefer editing the right module over adding new ones.
- Validation lives in `model.mjs` helpers (`tidy`, `cleanDomain`, `normalizeEmail`,
  `cleanHandle`, `count`, `list`, `byId`, `invalid`). Reuse them; do not re-implement parsing.
- Errors are `Object.assign(new Error(message),{status})`. Set a meaningful `status`;
  a statusless error becomes a generic 500 and logs the stack.
- **Do not add npm dependencies** or a build step. This is deliberate, and it is a rule with
  one recorded exception rather than an absolute: `pg@^8.23.1` is approved for the
  Neon/Postgres backend and is imported lazily in `db.mjs` so the SQLite path stays
  package-free. That is the complete list. If you think another dependency is unavoidable,
  stop and raise it instead of silently installing — and if it is approved, update §1,
  `CHECKLIST.md`, `docs/SECURITY.md` and `docs/CI-SECRETS.md` in the same change so the
  exception is never stated one way in one file and another way elsewhere.
- New server logic goes in `model.mjs` (pure, testable), not in `server.mjs` (thin HTTP).

## 6. Making a change (workflow)
1. Locate the owning module from §3; keep the change there.
2. If you touch a behaviour in §4, update or add a test in `test/` that locks it.
3. Run `npm run verify`. It must pass before you report completion.
4. Commit on a focused branch once `npm run verify` is green; this repository is the git root.
   Do not push or open a pull request unless the operator asks for it.

## 7. Testing notes
- Tests use Node's built-in runner (`node --test`, `node:assert/strict`). No test framework.
- `createState()` is deterministic enough to seed fixtures; deep-clone it per test to avoid
  cross-test mutation. Stub `globalThis.fetch` for provider/Jev paths (see `test/jev.test.mjs`).
- On Windows, run `node --test` with **no path argument** (a trailing-slash folder arg fails).

## 8. Known limits (context, not TODOs)
Gmail syncing, shared login, email digests, and "Coming soon" integrations need separate
provider/deployment work and are intentionally unimplemented. Do not fake them.
