# AGENTS.md — Outreach Desk

Standing instructions for any AI coding agent (Codex, etc.) working in this repository.
Read this before changing code. When a rule here conflicts with a request, follow the
rule and flag the conflict.

## 1. What this is
A **standalone, local, zero-dependency Node 24 app** for researching companies and
managing outbound outreach worklists. Single-user, loopback-only. SQLite via the built-in
`node:sqlite`. Vanilla-JS browser frontend. There is **no framework and no npm install**.

- Server + logic: `*.mjs` at the repo root.
- Browser code: `public/*.js` (ES modules loaded directly by the page).
- Data: `data/outreach.sqlite` (set `OUTREACH_DATA_DIR` to relocate; `PORT` to rebind).

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
1. **Loopback only.** Requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>`
   must be rejected. Never add a path that binds or serves on a non-loopback host.
2. **CSRF + content-type.** Every mutating endpoint goes through `requirePost`: JSON
   `content-type` and an `Origin` that equals `http://<host>`.
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
   guards, and the credit floors (Firecrawl 105-credit reserve; LimaData >=1 credit).
   Outcomes must be reviewed before saving; deliverability stays labelled unverified.

## 5. Coding conventions
- Match the existing compact style: no spaces inside `{}`/`()` for short helpers, arrow
  function helpers, `const` by default. Prefer editing the right module over adding new ones.
- Validation lives in `model.mjs` helpers (`tidy`, `cleanDomain`, `normalizeEmail`,
  `cleanHandle`, `count`, `list`, `byId`, `invalid`). Reuse them; do not re-implement parsing.
- Errors are `Object.assign(new Error(message),{status})`. Set a meaningful `status`;
  a statusless error becomes a generic 500 and logs the stack.
- **Do not add npm dependencies** or a build step. This is deliberate. If you think one is
  unavoidable, stop and raise it instead of silently installing.
- New server logic goes in `model.mjs` (pure, testable), not in `server.mjs` (thin HTTP).

## 6. Making a change (workflow)
1. Locate the owning module from §3; keep the change there.
2. If you touch a behaviour in §4, update or add a test in `test/` that locks it.
3. Run `npm run verify`. It must pass before you report completion.
4. Do not commit; the git root is the parent `codex-projects` tree — leave SCM to the operator.

## 7. Testing notes
- Tests use Node's built-in runner (`node --test`, `node:assert/strict`). No test framework.
- `createState()` is deterministic enough to seed fixtures; deep-clone it per test to avoid
  cross-test mutation. Stub `globalThis.fetch` for provider/Jev paths (see `test/jev.test.mjs`).
- On Windows, run `node --test` with **no path argument** (a trailing-slash folder arg fails).

## 8. Known limits (context, not TODOs)
Gmail syncing, shared login, email digests, and "Coming soon" integrations need separate
provider/deployment work and are intentionally unimplemented. Do not fake them.
