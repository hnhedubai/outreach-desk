# Outreach Desk — Post-Codex Verification Checklist

Run this after every Codex change to `outreach-desk/`. The detailed rules live in
`AGENTS.md` (§4 invariants) and `Jev_Scoring_Logic.md`; this is the quick pass/fail list.

## 1. Automated gate (must be green)
- [ ] `npm run verify` → `check` OK, all tests pass, **0 skipped** (baseline: 83 tests).
- [ ] `npm test` count has not silently dropped (a removed/weakened test is a red flag).
- [ ] No new dependency added beyond the one approved exception. `package.json`
      `dependencies` must contain exactly `pg@^8.23.1` and nothing else — `pg` exists solely
      for the Neon/Postgres backend and is imported lazily in `db.mjs`. The SQLite path stays
      Node-built-ins only. Anything further needs an explicit decision (AGENTS.md §5).

## 2. Invariants (eyeball the diff — from AGENTS.md §4)
- [ ] **Loopback-only by default**: Host guard still rejects any non-`127.0.0.1` /
      `localhost` host and validates against the server's actual bound port. If the change
      touches `OUTREACH_MODE=server`, confirm it still fails closed when
      `OUTREACH_ALLOWED_HOSTS` is empty and that the default path is unchanged.
- [ ] **CSRF**: `requirePost` still enforces JSON `Content-Type` + an `Origin` matching
      `<scheme>://<host>` (`http` locally, `X-Forwarded-Proto`-derived in server mode).
- [ ] **Response headers**: CSP / `X-Content-Type-Options: nosniff` / `Referrer-Policy:
      no-referrer` / `Cache-Control: no-store` unchanged.
- [ ] **Auth**: scrypt hashing + constant-time compare, min-10 password, session cookie stays
      `HttpOnly; SameSite=Strict; Path=/`.
- [ ] **Transport + store hygiene**: `enforceTlsVerification()` still runs before any provider or
      DB connection and nothing re-adds a way to disable certificate verification; the startup line
      names the active store; `OUTREACH_REQUIRE_NEON=1` still makes a missing `DATABASE_URL` fatal.
- [ ] **PII**: email redaction runs before any payload leaves to TypeSafe; `erase` still
      requires the literal `ERASE` token and wipes contacts, channels, notes, drafts,
      description, source, fitReview and jevFit.
- [ ] **Jev scoring**: one-record guard intact; an API failure throws (never becomes a low
      score); tier math and the C1–C4 anchors still match `Jev_Scoring_Logic.md` — including
      Iceland in the C1 top band and the 0.1 floors (C1/C2/C4) / 0.0 floor (C3).
- [ ] **Concurrency**: state writes still compare-and-swap on `revision` (409 on conflict).
- [ ] **Providers**: `redirect:'error'`, request timeouts, busy/lock guards, and credit floors
      (Firecrawl 105-credit reserve; LimaData >=1 credit) are preserved.

## 3. Runtime smoke (paths the suite can't fully cover)
- [ ] `npm start` boots; `GET /api/auth/status` → **200**.
- [ ] `GET /api/state` with no session cookie → **401**.
- [ ] Frontend loads. Optionally break one page builder once to confirm the fallback card +
      toast + Reload button appear, then revert. (No automated DOM harness exists by design.)

## 4. Hygiene
- [ ] Edits confined to `outreach-desk/`. The git root is the parent `codex-projects` tree —
      nothing outside `outreach-desk/` should be touched.
- [ ] No commit was created unless explicitly requested.

## How to use QoderWork for this
When Codex reports a change, paste its summary to QoderWork. It will run §1 and §3 directly
and diff §2 against the code, so the boxes above don't need to be checked by hand.
