# Outreach Desk — Security

Last reviewed: 2026-11-11
Reviewed against: current hardening worktree after `d374e1c` (baseline `cd90ef3`)
Scope of review: `auth.mjs`, `server.mjs`, `model.mjs`, `reset-password.mjs`, `public/*.js`

This document describes the security posture of the Outreach Desk application: its
threat model, the protections that are in place, the results of a source-level security
audit, and open hardening items. It is written for maintainers and reviewers, not end
users.

---

## 1. Intended deployment model

Outreach Desk is a **single-workspace, single-user, local application**. It:

- Binds to the loopback interface (`127.0.0.1`) by default. The only exception is the
  opt-in `OUTREACH_MODE=server` described in §1.1; with the flag unset nothing can
  make the app listen on a network address.
- Stores all data in a local SQLite file under the data directory
  (`OUTREACH_DATA_DIR`, default `./data`).
- Runs on Node built-ins plus **one declared dependency**, `pg`. It is imported lazily
  and only when `DATABASE_URL` selects the Postgres/Neon backend (`db.mjs:58`), so SQLite
  mode loads nothing external — but `pg` and its 13 transitive packages are installed
  regardless. Requires Node >= 24.
- Does **not** send email, sync Gmail, or integrate with Slack / HubSpot / Google
  Postmaster / Google Sheets. Those are explicitly out of scope.

The security goal is therefore **defense of a trusted local tool**: protect the one
credential, keep state on the machine, and prevent a malicious web page or another
origin from driving the app or reading its data. It is **not** a hardened multi-tenant
internet service, and controls are proportionate to that.

### 1.1 `OUTREACH_MODE=server` — opt-in, and not yet sufficient for public exposure

Setting `OUTREACH_MODE=server` relaxes the three guards that make the app unreachable
from behind a hosting proxy:

| Guard | Default (local) | Server mode |
|---|---|---|
| Bind address | `127.0.0.1` | `0.0.0.0` |
| `Host` validation | must equal `127.0.0.1:port` / `localhost:port` | must appear in `OUTREACH_ALLOWED_HOSTS` |
| CSRF `Origin` scheme | always `http://` | taken from `X-Forwarded-Proto`, defaulting to `https://` |

Startup **fails closed**: server mode without a non-empty `OUTREACH_ALLOWED_HOSTS`
throws and the process exits, so a misconfigured deploy cannot silently accept any
`Host`.

Two assumptions this mode makes, which the deploy must satisfy:

1. A trusted proxy terminates TLS and **overwrites** `X-Forwarded-Proto`. If clients
   can reach the instance directly, that header is attacker-controlled and the origin
   check can be downgraded to `http://`.
2. The host allow-list is the complete set of public names for the deployment.

**Server mode does not make the app safe to share.** It deliberately leaves the
remaining single-user assumptions intact: sessions live in an in-memory `Map`
(`auth.mjs`), so every restart logs users out and multiple instances cannot share
them; there is exactly one hardcoded username (`admin`, `auth.mjs:5`); and the session
cookie carries no `Secure` flag. Those are open work items, not oversights — until
they are addressed the app should not be exposed beyond a private network.

### Threat model — what we defend against

| Threat | Mitigated by |
|---|---|
| A malicious website making cross-site requests to the local app | Loopback bind + `Host` allowlist, `Origin` CSRF check, `SameSite=Strict` cookie |
| DNS rebinding (attacker domain resolving to 127.0.0.1) | `Host` header must equal `127.0.0.1:port` / `localhost:port` |
| Reading the credential store from a captured response | `HttpOnly` session cookie, `Cache-Control: no-store`, strict CSP |
| Stored XSS via imported lead/contact text | HTML escaping (`e()`) + CSP `script-src 'self'` (no `unsafe-inline`) |
| SQL injection | Parameterized statements only; no dynamic SQL |
| Unauthorized data access | Single authenticated gate on all data/mutating routes; fail-closed auth |
| Accidental PII retention | `erase` action wipes contacts/channels/notes/drafts/description/source/fitReview/jevFit |

### Out of scope

Threats that assume the operator's own machine or account is already compromised
(malware reading the SQLite file or `auth.json`, a local process brute-forcing the
loopback port, physical access). A local attacker with code execution on the machine
already has the data; hardening against that is an OS/disk-encryption concern, not an
application one.

---

## 2. Authentication

### Password storage
- Hashed with **scrypt** (`node:crypto` `scryptSync`), 32-byte derived key, **random
  16-byte per-password salt**, stored in `auth.json` (`auth.mjs:10-15`).
- Verification uses a **constant-time comparison** with a length guard
  (`auth.mjs:16-19,37-38`).
- Password policy: minimum 10 characters, maximum 200 (`auth.mjs:11`).

### Login flow
- Single username `admin` (`auth.mjs:5`).
- **Fail-closed**: if no `auth.json` exists, no
  password is accepted — the app cannot be logged into until one is set
  (`auth.mjs:33-43`). There is **no default or backdoor password**.
- On success a fresh session token is issued (`server.mjs:201-202`).

### Sessions
- Token: 32 random bytes, base64url (256-bit entropy) (`auth.mjs:51`).
- Stored in an **in-memory** map with an 8-hour absolute expiry; expired tokens are
  deleted on access (`auth.mjs:52-61`). Sessions do not survive a restart.
- Cookie: `outreach_session=...; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`
  (`server.mjs:202`).
- Password change rotates the secret and **invalidates all sessions**, then issues a
  new one (`server.mjs:217-224`).

### Setting / resetting the password
Password setup is a local CLI, not an HTTP route, so it cannot be reached over the
network:

```bash
npm run reset-password   # prompts twice, writes auth.json via a temp file + rename
```

(`reset-password.mjs`; atomic write at `auth.mjs:44-49`.)

---

## 3. Authorization & routing

All requests pass a `Host` allowlist check before anything else
(`server.mjs:186`). The route order enforces a single authentication boundary
(`server.mjs:210-211`):

**Pre-auth (intentionally public):**
- `GET  /api/auth/status` — returns only `{authenticated, configured}` booleans.
- `GET  /api/auth/login` — the login endpoint itself.
- `GET  /api/auth/reset-status` — returns only `{configured}`.
- Static files — from a **fixed allowlist `Map`**, never from the request path
  (`server.mjs:74,192-194`).

**Post-auth (everything else):** `/api/state`, `/api/action`, `/api/import-preview`,
`/api/search`, `/api/contact-email`, `/api/auth/logout`,
`/api/auth/change-password`, `/api/audit`.

No data-bearing or mutating route is reachable without a valid session. There is no
multi-user tenancy, so there is no cross-user IDOR surface; workspace/project/lead
lookups are by id within the single authenticated state.

---

## 4. Transport & request hardening

| Control | Detail | Location |
|---|---|---|
| Loopback bind | `server.listen(port, '127.0.0.1')` | `server.mjs:288` |
| Host allowlist | Rejects any `Host` not equal to `127.0.0.1:port` / `localhost:port` (403) | `server.mjs:186` |
| CSRF | State-changing requests must be JSON POST with `Origin === http://<host>` (403/405) | `server.mjs:123-126` |
| CSP | `default-src 'self'`; `script-src 'self'` (no unsafe-inline); `connect-src 'self'`; `form-action 'self'`; `frame-ancestors 'none'`; `base-uri 'none'` | `server.mjs:48` |
| Other headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` | `server.mjs:47-48` |
| Body size limits | 50 KB auth, 3 MB search/contact, 10 MB import/action; enforced on `Content-Length` and while streaming (413) | `server.mjs:52-67` |
| JSON parsing | Strict UTF-8 decode; must be a non-array object (400) | `server.mjs:68-72` |
| Error handling | Known errors return their message; unknown errors return a generic message and log the stack server-side only | `server.mjs:273-275` |

---

## 5. Data-layer security

- **SQL:** the entire database surface is six statements, all parameterized (`?`) or a
  static DDL string. There is **no dynamic SQL construction** anywhere in the codebase.
  (`server.mjs:26-29`, `score-nordic.mjs:8,29`.)
- **State model:** the application state is a single JSON document in one
  `workspace_state(id=1)` row. `model.mjs` is a pure in-memory reducer; user input is
  validated and coerced (lengths, enums, `cleanDomain`, `normalizeEmail`,
  `cleanHandle`) before it is persisted.
- **Prototype pollution:** not exploitable. Persisted objects are rebuilt field-by-field
  (`newLead`, `newContact`, `cleanFitReview`), which ignore unknown keys; the
  `Object.assign` sites target fixed-shape object literals (`model.mjs:356,443,465`).
- **PII erase:** gated on the literal token `ERASE`; clears contacts, channels, notes,
  drafts, description, source, and `fitReview`/`jevFit`, and suppresses the handles
  (`model.mjs:483-493`).

---

## 6. Frontend security

- A single HTML escaper `e()` (`ui.js:3`) is applied at render sites for lead/contact
  data (e.g. `project.js:105`).
- No inline event-handler attributes (`onclick=`/`onerror=`/…) are generated in the UI
  code, consistent with the CSP `script-src 'self'` policy.
- The XLSX parser (`spreadsheet.js`) reads cell values via `textContent` from the parsed
  workbook XML — it does not evaluate markup.
- Even if markup were injected, CSP blocks inline script execution and event handlers,
  and `connect-src`/`form-action 'self'` prevent exfiltration to an external origin.

---

## 7. Audit findings

Source-level review found **no exploitable SQL injection, authentication bypass,
cross-site request forgery bypass, stored-XSS execution path, or prototype-pollution
path**. The items below are residual hardening opportunities, all Low or informational,
and none remote-exploitable under the loopback threat model.

| # | Severity | Finding | Location | Recommended action |
|---|---|---|---|---|
| 1 | Resolved | Legacy **unsalted single-round SHA-256** password fallback was removed. Passwords now require the scrypt-backed `auth.json` flow. | `auth.mjs` | None; run `npm run reset-password` for an installation without `auth.json`. |
| 2 | Low / info | No rate-limiting or lockout on `/api/auth/login`. | `server.mjs:197-205` | Optional: small in-memory failure counter with short backoff. Low priority — port is loopback-only and cross-site is blocked. |
| 3 | Resolved | Audit CSV values are now prefixed with an apostrophe when they begin with a spreadsheet formula/control prefix (`=`, `+`, `-`, `@`, tab or carriage return). | `server.mjs` | None. |
| 4 | Low / info | Non-idempotent GETs (`/api/state`, `/api/audit`) can trigger daily worklist generation, which writes to the DB. Not CSRF-able (authed + `SameSite=Strict`). | `server.mjs:226,266` | Optional: move generation to the existing `setInterval` only. |
| 5 | Info | Session cookie omits `Secure`. Correct for `http://localhost`. | `server.mjs:202` | Add `Secure` only if the app is ever served over TLS. |

### Status
- Findings 1 and 3 were resolved in the current hardening worktree.
- Findings 2, 4, 5 remain accepted / optional for a local single-user tool.

---

## 8. Secure operations

- **Backups:** copy the SQLite file **and** its `-wal`/`-shm` sidecars **and**
  `auth.json`, with the server stopped, so the WAL is checkpointed
  (see `README.md`).
- **Password:** set via `npm run reset-password`; store the password in a password
  manager. Changing it invalidates all sessions.
- **Data directory:** keep `OUTREACH_DATA_DIR` on an encrypted volume (OS-level); the
  app does not encrypt data at rest.
- **Do not** expose the port beyond loopback or front it with a public reverse proxy
  without adding TLS, a `Secure` cookie, and (if multi-user) real access controls —
  none of which this app is designed for. `OUTREACH_MODE=server` (§1.1) relaxes the bind
  and `Host` checks but does **not** supply any of those, so it is not a green light to
  publish the app.
- **Dependencies:** the app is deliberately minimal, not dependency-free. It runs on Node
  built-ins plus one approved exception, `pg@^8.23.1`, required only by the Neon/Postgres
  backend and imported lazily so SQLite mode loads nothing external. That exception is
  recorded in `AGENTS.md` §5 and `CHECKLIST.md` §1 — treat it as the complete list. Adding
  any further dependency (e.g. a DOM test harness such as jsdom/Playwright) should be a
  deliberate, reviewed decision, since it changes the supply-chain surface, and must update
  every file above in the same change.

---

## 9. Reporting a concern

This is a local internal tool. If you find a security issue, describe the exact file and
line and a reproduction, and open it as a task for the maintainer. Prefer fixes that keep
the minimal-dependency policy in `AGENTS.md` §5 (`pg` being the one approved exception) and
the default loopback-only behaviour intact. `OUTREACH_MODE=server` is the narrow, opt-in
exception to the latter and is documented in §1.1.
