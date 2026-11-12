# LimaData → Reoon Email Integration (Reference)

Status doc for the contact-email pipeline. Records what is wired today (verified
against code, with `file:line`), and the phased plan for adding Reoon verification
and valid/invalid display. Keep this updated as each phase lands.

Last verified: 2026-11-12 against commit `b7bf9a0`.

---

## 1. What LimaData does today (fully wired, narrow scope)

LimaData is integrated end-to-end for **one** capability: *find a single contact's
work email by name + company domain*. It does **not** verify deliverability.

### Core call — `research-providers.mjs`
- `findLimaEmail(name, domain)` (L80): guards `LIMADATA_API_KEY`, single-flight lock
  (`limaBusy`, rejects concurrent with 429), checks credit balance ≥ 4
  (`LIMA_EMAIL_LOOKUP_COST`), then `POST {limaBase}/find/email_work`
  body `{full_name, company_domain}`.
- `classifyLimaResult(result, domain)` (L37): returns
  `{outcome: 'match' | 'no_result' | 'invalid_result', email, message}`.
  - `match` = an email whose domain equals (or is a subdomain of) the company domain.
  - `invalid_result` = an email returned but outside the company domain.
  - `no_result` = nothing found.
- `limaAvailable()` (L4): true when the key is set; exposed to the client.

### Server route — `server.mjs`
- Import (L10); availability flag to client (L107).
- `lookupContactEmail(state, input)` (L188), reached via `POST /api/contact-email`
  with `{workspace, project, lead, contact}`:
  - 404 if contact missing; 409 if contact already has an email.
  - Returns `{...classifyResult, contact, expectedName, expectedDomain}`.

### Persistence — `model.mjs`
- Action `save-lima-email` (L474): re-validates under optimistic revision CAS —
  rejects (409) if the contact/company changed, or if the email domain doesn't
  match the lead domain (L476-480). On success sets:
  - `contact.email = <normalized>` (L481)
  - `contact.emailSource = 'LimaData'` (L482)
- Contact record shape `newContact` (L59): `{id, name, title, email, linkedin, source}`.
  There is **no** `emailVerified` / `verifyStatus` / `verifiedAt` field yet.
- `contact-edit` clears `emailSource` when the email changes (L470).

### UI — `public/app.js` / `public/flow.js`
- Button `lima-email` (app.js L450): disabled unless `limaAvailable` and lead is live;
  calls `/api/contact-email`; on `outcome==='match'` opens the `lima-review` dialog,
  otherwise shows the message as a toast.
- `lima-review` dialog (app.js L165): shows name · domain and the email with the
  explicit caption **"LimaData match. Deliverability is unverified."** (L168);
  submit posts `save-lima-email`.
- Contacts table renders `c.email` (flow.js L53); no verification badge today.

### Tests / CI
- `test/research-providers.test.mjs`: 17 cases covering `classifyLimaResult` and
  `findLimaEmail` (match / no_result / invalid, credit gating, missing key, 429).
- `.github/workflows/outreach-desk.yml` + `scripts/live-smoke.mjs` `checkLimaData`:
  hit the credits endpoint. (`npm run verify` = `check` + `node --test`.)

---

## 2. What is NOT integrated

- **Reoon — zero code.** Only `REOON_API_KEY` exists in `.env`. No provider module,
  route, model action, UI, or test references Reoon. It is provisioned but unwired.
- **No verification state anywhere.** The only "valid/invalid" signal today is
  LimaData's domain-match heuristic (`invalid_result`). `ui.js` `'Invalid handle'`
  is a *manual outreach mark*, not an API result. There is no field storing whether
  an email was verified, when, or with what result.
- **No bulk path.** `findLimaEmail` is strictly one-at-a-time (busy lock).

---

## 3. Phased integration plan (for discussion)

Principle: build one thin vertical slice (find → verify → display) for a single
contact first, prove it, then widen to bulk and add more providers. Each phase is
shippable and independently verifiable.

### Phase A — Reoon verify, single contact (the core new slice)
- **Provider module**: add `verifyReoonEmail(email)` alongside `findLimaEmail` in
  `research-providers.mjs`; mirror the existing guards (key check, credit/balance
  check if applicable, timeout, error classification). Reuse `providerRequest`/
  `providerJson`.
- **Inputs**: the `email` string (output of LimaData). *(Confirm exact Reoon endpoint
  + request/response shape before coding — see §4.)*
- **Trigger / when**: after a LimaData `match`, before showing `lima-review`. Either
  (a) server-side automatically inside `lookupContactEmail` (one round-trip for the
  user, two API calls), or (b) a second explicit button "Verify" in the review dialog
  (user controls when credits are spent). **Decision needed.**
- **Where to update**: extend the `save-lima-email` action (or a new `verify-email`
  action) to persist verification onto the contact record — new fields, e.g.
  `emailVerified: 'valid'|'invalid'|'catch-all'|'unknown'`, `verifiedAt`, `verifySource:'Reoon'`.
- **Output → display**: render a badge in the contacts table (flow.js L53) and in the
  review dialog: valid (green) / invalid (red) / catch-all or unknown (amber).
  Reuse the existing `--green`/`--danger`/`--warning` tokens.
- **How to verify the work**: unit tests for the Reoon classifier (valid/invalid/
  catch-all/error/credit-gate), a live-smoke credits check, and the existing CAS
  re-validation guards.

### Phase B — Bulk find + verify
- Batch endpoint (Reoon has bulk-style endpoints; LimaData path is single-flight).
- Queue/progress UI, per-record credit accounting, partial-failure handling.

### Phase C — More providers (decoupled, pluggable)
- Generalize `research-providers.mjs` into a small provider registry so additional
  sources (e.g. phone, other email finders/verifiers) plug in with the same
  guard + classify + persist + display pattern.

---

## 4. Open questions to settle before Phase A coding

1. ~~Reoon endpoint + request/response schema~~ **Resolved — see §6.** Cost is
   **1 credit/email** and we bill **POWER** mode. Schema + credit gate fully defined.
2. Trigger model: auto-verify on find, or explicit "Verify" action (credit control)?
3. Verification result vocabulary to store (Reoon's status set → our enum).
4. Do we verify only LimaData-found emails, or also manually-entered/imported ones?
5. Display: badge only, or also gate outreach sending on valid status?

---

## 5. Coupling / sequencing note

Keep each provider behind the existing guard → classify → persist → display pattern
so APIs stay loosely coupled: a new source adds one module function + one model
action + one badge, without touching the others. Commit each phase separately with
tests, verify against code/git (not agent self-reports), then deploy.

---

## 6. Reoon API schema (verified against official docs, 2026-11-12)

Source: `https://www.reoon.com/articles/api-documentation-of-reoon-email-verifier/`
(docs last modified 2025-12-18). Base host `https://emailverifier.reoon.com/api/v1`.

**Auth**: API key is a **query param `key=`** (NOT a header — unlike LimaData's
`x-api-key`). So `providerRequest`/`providerJson` are reused, but the key goes in
the URL, not `headers`.

### Single verify (Phase A target)
`GET /verify?email=<email>&key=<key>&mode=quick|power`
- `mode=quick` is the default; `mode=power` must be passed explicitly.
- Do not run the single endpoint in more than 5 concurrent threads.

| | QUICK | POWER |
|---|---|---|
| Speed | <0.5s | seconds → ~1 min |
| Checks inbox exists | **No** (domain-level only; non-existent inboxes on a good domain are marked valid) | Yes |
| `status` enum | `valid`, `invalid`, `disposable`, `spamtrap` | `safe`, `invalid`, `disabled`, `disposable`, `inbox_full`, `catch_all`, `role_account`, `spamtrap`, `unknown` |
| Extra fields | username, domain, is_valid_syntax, is_disposable, is_role_account, mx_accepts_mail, is_spamtrap, is_free_email, mx_records[] | all of quick **plus** overall_score (0-100), is_safe_to_send, can_connect_smtp, has_inbox_full, is_catch_all, is_deliverable, is_disabled, verification_mode |

**Recommendation**: use **POWER** mode — QUICK's "valid everything on a good domain"
behaviour defeats the purpose of verification for deal-sourcing outreach. Map our
stored `emailVerified` enum from POWER `status`:
`safe → valid`; `catch_all → catchall` (amber, send-with-caution);
`invalid|disabled|spamtrap|disposable|inbox_full|role_account → invalid` (red, with
the raw status kept for the tooltip); `unknown → unknown` (amber).

**Canonical POWER request** (key + mode both in the query string):
```
GET https://emailverifier.reoon.com/api/v1/verify?email=<email>&key=<key>&mode=power
```

**Canonical POWER response** (verbatim from Reoon docs, 2026-11-12 — the shape our
classifier must parse):
```json
{
  "email": "jhon123@gmail.com",
  "status": "safe",            // safe|invalid|disabled|disposable|inbox_full|catch_all|role_account|spamtrap|unknown
  "overall_score": 98,         // 0-100
  "username": "jhon123",
  "domain": "gmail.com",
  "is_safe_to_send": true,
  "is_valid_syntax": true,
  "is_disposable": false,
  "is_role_account": false,
  "can_connect_smtp": true,
  "has_inbox_full": false,
  "is_catch_all": false,
  "is_deliverable": true,
  "is_disabled": false,
  "is_spamtrap": false,
  "is_free_email": true,
  "mx_accepts_mail": true,
  "mx_records": ["gmail-smtp-in.l.google.com", "..."],
  "verification_mode": "power"
}
```
Note `status` is the primary signal; `is_safe_to_send` mirrors it, and the boolean
flags (`is_catch_all`, `is_disabled`, `has_inbox_full`, `is_role_account`,
`is_spamtrap`, `is_disposable`) explain *why*. Bulk results reuse this same object
keyed by email.

### Bulk verify (Phase B target)
Two-step, always POWER mode:
1. `POST /create-bulk-verification-task/` body `{name?, emails[], key}` → **201**
   `{status:'success', task_id, count_submitted, count_duplicates_removed,
   count_rejected_emails, count_processing}`. Up to 50,000 emails; ≤10 emails → use
   the single endpoint instead.
2. `GET /get-result-bulk-verification-task/?key=<key>&task_id=<id>` →
   `{task_id, name, status: waiting|running|completed|file_not_found|file_loading_error,
   count_total, count_checked, progress_percentage, results?: {<email>: {...power fields}}}`.
   **Poll** until `status==='completed'`, then read `results` keyed by email.
   (Note: docs' own Python snippet has a typo `task-id`; the canonical param is `task_id`.)

### Balance / credit gate
`GET /check-account-balance/?key=<key>` →
`{api_status:'active', remaining_daily_credits, remaining_instant_credits, status:'success'}`.
Two separate credit pools (daily + instant). **Cost: 1 credit per email verified**
(confirmed 2026-11-12), so define `REOON_VERIFY_COST = 1` and gate the same way as
LimaData's `LIMA_EMAIL_LOOKUP_COST` — check balance before the `/verify` call and
fail with 402 if `remaining < 1`.

### Classifier contract to implement (`verifyReoonEmail`)
Return `{outcome:'valid'|'invalid'|'catchall'|'unknown', status, score, safeToSend, message}`
from a POWER response, throwing the same `failure(status,msg)` shape as LimaData for
401/402/429/timeout so the existing error handling and UI toasts work unchanged.
