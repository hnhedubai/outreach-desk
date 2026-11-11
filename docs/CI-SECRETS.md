# Outreach Desk — CI Secrets

Last reviewed: 2026-11-11
Reviewed against: `main` at `aa53459`
Scope: GitHub Actions secrets, environments, and the `Outreach Desk` workflow
Audience: maintainers. Not end users.

This document records the plan for adding provider API keys to CI, the evidence that
constrains it, and the design that was chosen. It exists because the obvious move —
putting the keys in the CI job environment — would actively break the test suite.

---

## 1. Current state (verified, not assumed)

| Fact | Evidence |
| --- | --- |
| Repo `hnhedubai/codex-projects` is **public** | `GET /repos/... ` → `private: false` |
| Default branch `main`, **protected** | `GET /branches/main/protection` → required status check `Verify` (strict), required PR reviews; `enforce_admins` disabled |
| Workflow live: `Outreach Desk`, 1 file | `actions/workflows` → `total_count: 1`, state `active` |
| CI green from the first run | run #1, event `push`, sha `aa53459`, `completed` / `success`, 7 s |
| Actions secrets: **none at repo level** | `actions/secrets` → `total_count: 0`. The 5 provider keys are scoped to the `production` environment instead |
| Self-hosted runners: none | `actions/runners` → `total_count: 0` |
| One dependency, lockfile present | `pg@^8.23.1` + `package-lock.json` (14 resolved packages). CI installs nothing — `pg` is only imported when `DATABASE_URL` is set, and CI never sets it |
| Runtime | Node `>=24`; SQLite via built-in `node:sqlite`, Postgres via lazy `pg`. CI needs no `npm install` |

The `verify` job runs `npm run verify` = `node --check` (syntax) + `node --test`
against `outreach-desk/test/`.

---

## 2. Why `verify` must stay secret-free

This is the central constraint. Three independent findings.

**2.1 Tests never touch the network.** Every provider call is stubbed by replacing
`globalThis.fetch`:

- `test/edge-cases.test.mjs:31`
- `test/jev.test.mjs:34`
- `test/research-providers.test.mjs:33`

There is no `fetch('https://...')` anywhere under `test/`.

**2.2 Tests deliberately mutate the key variables.** They capture the real value and
restore it in a `finally` block — `edge-cases.test.mjs:14` reads
`realKey=process.env.TYPESAFE_API_KEY`, line 32 restores it. `server.test.mjs` asserts
HTTP **503 specifically when `EXA_API_KEY` is missing**.

So a real key present in the job environment is not merely useless, it is
**adversarial**: it flips the precondition those tests rely on.

**2.3 There is no opt-in live path today.** Searching the tests for `skip` / `LIVE`
returns zero matches. Nothing would "unlock" when a key appears — meaning any future
test that forgets to mock `fetch` would silently spend real provider credits on every
push.

**Rule:** the `verify` job gets no secrets and no provider environment variables. Ever.

---

## 3. Secret inventory

Read from source, with the file that consumes each one:

| Variable | Consumed at | Kind |
| --- | --- | --- |
| `EXA_API_KEY` | `server.mjs:91` | secret |
| `FIRECRAWL_API_KEY` | `firecrawl.mjs` | secret |
| `PERPLEXITY_API_KEY` | `research-providers.mjs` | secret |
| `LIMADATA_API_KEY` | `research-providers.mjs` | secret |
| `TYPESAFE_API_KEY` | `jev.mjs` | secret |
| `TYPESAFE_MODEL` | `jev.mjs:73` — `process.env.TYPESAFE_MODEL?.trim()\|\|'jev-latest'` | **optional config, not a secret** — see 3.1 |
| `PORT` | `server.mjs:25` (default `8282`) | **config — not a secret** |
| `OUTREACH_DATA_DIR` | `server.mjs:26` (default `./data`) | **config — not a secret** |

`.env` is already ignored (`outreach-desk/.gitignore:2`). Keep it that way.

### 3.1 Correction to the first draft of this document

The first version of section 5 stated that the smoke test must "exit non-zero if
`TYPESAFE_MODEL` is unset, since `jev.mjs` needs it." **That is wrong.** `jev.mjs:73` falls
back to `'jev-latest'` when the variable is absent, so the application runs correctly
without it. A smoke test that treats `TYPESAFE_MODEL` as fatal would be stricter than the
software it is meant to validate. It is now classified as optional config.

This mattered because the error was faithfully implemented, not caught — see section 13.

---

## 4. The public-repo exposure problem

On a public repository, anyone with write access can add a step that exfiltrates a
secret. GitHub masks secret strings in logs, but a step that encodes and ships the
value elsewhere defeats that. Fork-based PRs cannot read secrets by default, but
`push`-triggered runs on `main` can.

Two acceptable answers:

- **Option A — make the repo private.** No extra machinery. Best if there is no reason
  for the repo to be public.
- **Option B — Environments with protection rules.** Secrets are scoped to a
  `production` environment that requires manual approval from an allowlist. They are
  injected **only** into jobs that declare `environment: production`. The repo can stay
  public.

**Chosen: Option B**, because it remains correct if the repo later becomes private, and
because it forces every secret-consuming job to opt in explicitly, which is the property
section 2 needs.

---

## 5. Target design

1. A `production` environment with a `required_reviewers` protection rule (reviewer:
   `hnhedubai`).
2. The six variables from section 3 created as **environment** secrets, not repo secrets.
3. A new `live-smoke` job in the workflow:
   - `if: github.event_name == 'workflow_dispatch'` — manual only, never on push or PR
   - `environment: production`
   - maps secrets to `env:` at the **step** level, not the job level
   - runs `scripts/live-smoke.mjs`
4. `verify` unchanged: no secrets, no new env, same steps.
5. Optional hardening — a step in `verify` that **fails if any provider key is present**
   in the environment. This turns the section 2 rule from a convention into something CI
   enforces, and it adds no secrets.

`live-smoke.mjs` requirements:

- call each provider's cheapest authenticated read (a credits/balance endpoint) to prove
  the key is valid and funded
- fail **closed**: non-zero exit on any missing key or auth failure
- **endpoint provenance is mandatory.** Every URL, auth header and response shape the
  smoke test relies on must already appear in this application's own source, with a
  `file:line` citation. An endpoint that is merely plausible, or that exists in vendor
  documentation the repo has never exercised, is not acceptable — it produces a CI failure
  that cannot be distinguished from a dead key. Corrected references:
  `EXA` → `server.mjs:164`; `Firecrawl` → `firecrawl.mjs:40`; `LimaData` →
  `research-providers.mjs:87`; `Perplexity` → `research-providers.mjs:72`; `TypeSafe` →
  `jev.mjs:100` (`/v1/systemone`)
- `TYPESAFE_MODEL` must **not** be treated as fatal (see 3.1). If it is set, verify it is
  accepted; if it is unset, the check still passes because the app defaults to `jev-latest`
- print only provider name + PASS/FAIL; never the key, never a full response body, never
  write to disk
- be runnable locally against the same `.env`
- a check that spends real credits (for example any billable search call) must be labelled
  as such in the output so a routine run is not mistaken for a free probe

---

## 6. Implementation phases

**Phase 1 — local, pre-approved.** Write `scripts/live-smoke.mjs`, the workflow diff, and
the hardening step. No commit. *(Done — see section 13.)*

**Phase 1.5 — run the script once locally against the real `.env`.** This is the step that
actually proves each endpoint. It spends a small amount of real credits and reads the keys
from disk, so it requires explicit approval. Phase 2 must not start until every check has
been observed to PASS at least once.

**Phase 2 — GitHub writes, in this exact order, each one individually approved.**

1. Create the `production` environment.
2. Attach the required-reviewer protection rule.
3. Set the five provider keys as environment secrets. Add `TYPESAFE_MODEL` as an
   environment **variable**, not a secret, only if you want to pin a model.
4. Commit with path-scoped staging, then push the workflow.
5. Run the checks in section 7.

**Why the order is mandatory, not cosmetic:** GitHub **auto-creates** an environment the
first time a workflow run references one that does not exist. If the workflow is pushed
before steps 1–2, `production` is created **without any protection rule**, and
`live-smoke` will then execute with no approval gate. Today the blast radius is small (no
secrets exist, so the script fails closed), but the moment keys are present an
auto-created unprotected environment means an unapproved job holding live provider
credentials. The protection rule must therefore exist *before* the secrets, and both must
exist *before* the workflow is pushed.

Hard rules carried into both phases:

- Never print, echo, log, commit, or paste a secret value — including in a report.
- Never commit `.env` or any file containing a real key.
- Stage explicit paths only. The parent repo carries a large amount of unrelated
  uncommitted work (`8181/`, `apps/`, `database/`, `docs/`, spreadsheets, scripts);
  `git add -A`, `git add .` and `git commit -a` are forbidden.
- Do not bypass `.githooks/pre-commit` (see section 8).

---

## 7. Verification checklist

1. List secrets — repo and `production` environment — by **name only**.
2. After the push, poll the run for the new SHA until `status=completed`; `verify` must be
   `success`.
3. Trigger `live-smoke` manually and confirm the run enters `waiting` for approval rather
   than executing. If it runs unattended, the protection rule failed — stop.
4. Read the raw logs of every job that ran and confirm no secret string appears.
5. Record the final workflow file contents (safe — it holds only `${{ secrets.NAME }}`
   references).
6. Deliberately break one key and confirm `live-smoke` fails closed instead of skipping.

---

## 8. Known obstacle: the pre-commit typography gate

`core.hooksPath = .githooks`, and `.githooks/pre-commit:4` runs:

```
node scripts/audit-tokens.mjs --path apps/web/public --props font-size,font-weight --max 1
```

The hook is **unconditional** — it never inspects staged paths — and the audit reads the
**working tree**. It currently fails on unrelated typography WIP in `apps/web/public`
(18 dirty entries, including an untracked `tokens-typography.css`; 18 distinct
`font-size` and 8 distinct `font-weight` values against `--max 1`).

Consequence: **every** commit in this repository is blocked until that work lands,
regardless of what it touches. `aa53459` was committed with `--no-verify` under explicit
approval. The correct permanent fix is to make the hook path-aware so it only runs when
`apps/web/**` is staged; that is a separate change to a tracked file and needs its own
review.

---

## 9. Rotation and hygiene

- Rotate all five keys once they have first been used in CI.
- Set a provider-side spend cap per key; CI-originated calls bypass normal usage review.
- Re-check `actions/secrets` quarterly and delete any unused entry.
- Prefer short-lived provider keys where the vendor supports them.

## 10. Rollback

`gh secret delete <NAME> --env production`, then revert the workflow commit. `verify` is
untouched throughout, so CI never goes dark and rollback never costs coverage.

---

## 11. Open decisions

1. **A vs B** — Option B is assumed. If the repo becomes private, drop the environment and
   protection rule and keep only the gated `live-smoke` job.
2. **Is `live-smoke` wanted at all?** It is the only reason any secret needs to exist in
   CI. If deployment happens elsewhere and nobody wants a manual key-validity check, the
   correct plan is **zero secrets** and this document becomes a record of why.
3. **Who owns `.githooks/pre-commit`** before it is changed.
4. ~~`TYPESAFE_MODEL`~~ — **resolved**: it is optional config (`jev.mjs:73` defaults to
   `jev-latest`), not a secret. See 3.1.
5. **Does `live-smoke` need its own spend budget?** — **answered**: yes, and it is small.
   Exa and Perplexity are billable searches, marked `(billable)` in the output. Firecrawl,
   LimaData and TypeSafe are free reads. Set provider-side caps before enabling dispatch.

---

## 12. Note on command syntax

The `gh` invocations used while drafting this plan (notably `gh secret set --env` and the
protection-rule `PUT`) are plausible but were **not executed**, so they are not verified.
Confirm flags with `gh secret set --help`, `gh environment --help` and `gh api --help`
before running anything against the live repo.

---

## 13. Phase 1 audit record (2026-11-11)

Phase 1 was executed locally. No commit, push, staging, GitHub write, or secret value read
occurred. State on disk: `.github/workflows/outreach-desk.yml` is **modified** (71 lines,
`workflow_dispatch` at line 12, hardening step at 35–43, `live-smoke` job at 49–71) and
`outreach-desk/scripts/live-smoke.mjs` is **new and untracked**.

**Verified good:**

- `node --check` on the script → exit 0
- `npm run verify` → 62 passed, 0 failed, 0 skipped
- Fail-closed behaviour → all five providers report `FAIL` and `exit=1` when the variables
  are cleared
- `verify` gained no secrets; the added step only asserts their absence
- Secrets are mapped at **step** level, not job level, as required

**Endpoint provenance at the time of the audit:**

| Provider | Script | App source | Status |
| --- | --- | --- | --- |
| Exa | `POST /search`, `x-api-key` | `server.mjs:164` identical | corroborated |
| Firecrawl | `GET /v2/team/credit-usage` | `firecrawl.mjs:40` same path | corroborated |
| LimaData | `GET /credits/balance`, floor 4 | `research-providers.mjs:87`, and 4 is the app's own policy | corroborated |
| Perplexity | `GET /models` | `research-providers.mjs:72` uses `/search`, expects `results[]` | **unverified** |
| TypeSafe | `GET /v1/models`, expects `models[].name` | `jev.mjs:100` uses `/v1/systemone` only | **unsupported** |

Two checks therefore rest on endpoints this codebase has never called. The Phase 1 report
described the TypeSafe one as "documented", which was an assumption presented as fact.

**Open gap:** the PASS path has never been exercised, so no provider has yet been proven
reachable by this script. Phase 1.5 exists to close that before any credential is placed in
CI.

**Also noted:** `scripts/live-smoke.mjs` is not in the `npm run check` file list, so CI does
not currently syntax-check it. A non-JSON `200` response is reported as `FAIL` because
`json()` swallows the parse error, which conflates "key is dead" with "response shape
changed".

### 13.1 Phase 1.5 outcome — 2026-11-11, supersedes parts of the table above

The PASS path has now been exercised against real credentials. Final result:

```
TLS certificate verification: active
EXA: PASS (billable)          Firecrawl: PASS          Perplexity: PASS (billable)
LimaData: PASS                TypeSafe: PASS           exit=0
```

**The "LimaData credential is dead" conclusion in the table above was WRONG and is
withdrawn.** The real cause was credential shadowing: a stale `LIMADATA_API_KEY` existed as
a Windows user-scope environment variable, and Node's `--env-file-if-exists` does **not**
override variables already present in the process environment. The app and the smoke test
were therefore using the ambient key (HTTP 401) and never reading the `.env` key (HTTP 200,
592 credits). Four of the five provider keys were shadowed this way — Exa, Firecrawl,
LimaData and Perplexity all had ambient values differing from `.env`. The stale user-scope
variables have since been removed.

This has a lasting operational consequence: **a `missing-key` or `auth` result from this
script is not trustworthy until you confirm no ambient provider variable is set.** The
script now prints a TLS-verification line and coarse reason tokens to make misreads less
likely, but it cannot see the shadowing itself.

Corrections applied to the code:

- **Perplexity** — `GET /models` returned HTTP 404; that endpoint does not exist. Replaced
  with the app's own `POST /search` (`research-providers.mjs:72-73`), minimal body. Now
  PASS, and labelled `(billable)` because it spends credits.
- **TypeSafe** — the endpoint and response shape were correct all along (`/v1/models`
  returns `jev-latest` and `jev-preview`). The failure was the fatal `TYPESAFE_MODEL` guard
  inherited from the first draft of this document. Now mirrors `jev.mjs:73` and defaults to
  `jev-latest`.
- **Reason tokens** — failures now report `missing-key`, `auth`, `http-<status>`,
  `unexpected-shape`, `low-credits`, `unknown-model`, `network` or `timeout`, so a changed
  response shape can never again be mistaken for a revoked key.
- **`npm run check`** now includes `scripts/live-smoke.mjs`, so CI syntax-checks it.
- **Workflow** — `TYPESAFE_MODEL` removed from the `live-smoke` step env. It is optional
  config, so the Phase 2 secret count is **five**, not six. The `verify` job's
  "Assert provider secrets are absent" step still checks all six names, which is correct —
  it asserts absence.

`npm run verify` after all changes: **62 passed, 0 failed, 0 skipped**. Fail-closed
behaviour re-verified with every variable cleared: all five report `FAIL [missing-key]`,
`exit=1`.

Two checks are now billable (Exa and Perplexity), so each `live-smoke` dispatch costs a
small amount on those two providers. This answers open decision 5 in section 11.
