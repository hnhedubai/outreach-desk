# Neon Platform Capabilities — System-Engineering Assessment

Scope: what belongs in Neon as DB code (functions/procedures/triggers), how to get
intent-based output on DML, whether we can call external APIs from the DB, and how
to push data to the frontend. Written against **this project's live Neon instance**
(verified 2026-11-12), not generic Postgres theory.

---

## 0. Grounded facts about THIS instance (verified live)

| Fact | Value | Source |
|---|---|---|
| Postgres version | **18.6** | `current_setting('server_version')` |
| Procedural languages | `plpgsql`, `sql`, `c` only | `pg_language` |
| NO `plv8` / `plperl` / `plpython3u` | confirmed absent | `pg_available_extensions` |
| NO `http` (pgsql-http) / `pg_net` | confirmed absent | `pg_available_extensions` |
| Available (not installed) | `dblink`, `pg_cron`, `postgres_fdw`, `neon`, `citext`, `pgcrypto`, `vector` | `pg_available_extensions` |
| State model | single row `workspace_state(id int, revision int, document text)` | `information_schema.columns` |
| Write pattern | whole-`document` overwrite, optimistic revision CAS (in app) | `model.mjs` / `server.mjs` |
| Connection | through the **pooler** (`...-pooler...neon.tech`) → PgBouncer | `.env DATABASE_URL` |
| Current DB logic | 0 routines, 0 triggers | `pg_proc` / `pg_trigger` |

**Two consequences that frame everything below:**
1. **Neon cannot call external HTTP APIs from SQL.** pgsql-http and pg_net are not
   offered; `dblink`/`postgres_fdw` only reach other Postgres. So Reoon / LimaData /
   Firecrawl can NOT be invoked from a function, procedure, or trigger.
2. **The app is a document store, not a relational one.** Every save rewrites one
   `document` text blob. There is no per-lead/per-contact DML for a trigger to react
   to at record granularity.

---

## 1. Functions & procedures (plpgsql / SQL)

**What fits well in Neon:**
- Pure data transforms, validation, aggregation, hashing.
- Read-side helpers over the document, e.g. a function/view that does
  `document::jsonb` extraction to answer "how many leads have valid domains" without
  shipping the whole blob to the app.
- `pgcrypto` (available) for DB-side hashing/encryption if you want it near the data.

**What does NOT fit here:** business-logic writes. The reducer (`model.mjs`) is the
single source of truth behind a CAS revision check in the app. Moving mutations into
SQL procedures splits that authority and fights the optimistic-revision model (two
writers, one row, one revision).

**Recommendation:** keep all mutations in the app. Use DB functions only for
**reporting/read helpers**, and only over `document::jsonb`.

---

## 2. Triggers on DML — "output based on intent"

Standard Postgres triggers (BEFORE/AFTER row/statement INSERT/UPDATE/DELETE) DO work
on Neon. The problem is **granularity**, not support:

- The app fires one `UPDATE workspace_state SET document=..., revision=...`. A row-level
  `AFTER UPDATE` trigger sees "the document changed," not "lead X's domain changed."
- To get intent you'd parse `NEW.document::jsonb` vs `OLD.document::jsonb` inside the
  trigger and diff — expensive (whole doc, twice) and fragile, for every single save.

**Triggers become clean and worthwhile ONLY IF you decompose `document` into
relational tables** (`leads`, `contacts`, …). Then:
- `AFTER UPDATE OF domain ON leads` → set `domain_verified='pending'`, `NOTIFY`, stamp
  `updated_at`, or append an audit row — exactly the "output based on intent" you want.
- Validation triggers (domain format, email-domain match) enforce consistency at the
  data layer, not just the app layer.

**Low-risk trigger that works today:** an `AFTER UPDATE ON workspace_state` trigger that
appends a lightweight audit row (`revision, changed_by, at`) — cheap, no JSON diffing.
Useful if you want DB-side change history independent of the app's audit array.

---

## 3. "Neon HTTP" — API calls from the DB

- **From SQL: not possible.** No pgsql-http / pg_net. `pg_cron` (available) can schedule
  a job, but the job body is plpgsql SQL — which also cannot make HTTP calls. So a
  scheduled DB job cannot hit Reoon/LimaData/Firecrawl directly.
- **The Neon-native home for external calls is Neon Functions** (public/GA in 2026):
  long-running serverless compute deployed onto a Neon branch, running next to your
  database, with a public URL and a Node/Deno runtime. That runtime CAN call Reoon
  (verify), LimaData (find), Firecrawl (search) and write results back to the DB.
  This is where the email find→verify→bulk pipeline belongs if you want it decoupled
  from the Render app.
- **Alternative:** keep API calls in the existing Node app (`server.mjs`), as today —
  simplest, no new infra.

**Decision axis:** Neon Function (decoupled, scales independently, near the data, can
own bulk verification + scheduling) vs. in-app (one codebase, one deploy, already has
the provider modules + credit gates).

---

## 4. Neon Realtime — push data to the frontend

- **Neon Realtime (public beta, changelog 2026-10-16, built by the Electric team)**
  turns any SQL query into a live subscription; the result stays current as data
  changes, with **no polling/refetch**. Enabled per branch (`neon realtime enable`),
  secured by a shared secret.
- This is the proper replacement for the app's current "reload whole state on each
  action" model.

**Caveats that matter for THIS app:**
1. **Do NOT use `LISTEN`/`NOTIFY`.** Two blockers: (a) the app connects through the
   **pooler** in transaction mode, which breaks session-level LISTEN; (b) Neon compute
   **scales to zero after ~5 min idle**, ending any listening session. Neon Realtime
   uses its own replication path and avoids both.
2. **Coarse vs fine push:** because the app writes ONE document row, a Realtime
   subscription on it re-pushes the **entire state** on every change. Realtime's value
   (per-row live updates) only materialises with a **relational schema** (subscribe to
   `leads`/`contacts` per project).

---

## 5. Architecture recommendation

1. **Do not** push business logic into DB triggers/HTTP now — the single-document text
   model + pooler + CAS make it a poor fit, and Neon can't do SQL HTTP at all.
2. **The strategic unlock is decomposing `document` into relational tables.** That is
   the prerequisite that makes triggers (intent-based DML output), fine-grained
   functions, and Neon Realtime (live per-record push) all clean and worth having.
   Until then, the DB is best used as a durable store + reporting helpers, with all
   mutations in the app.
3. **Quick wins that don't require decomposition:**
   - **Neon Function** to own the Reoon/LimaData/Firecrawl pipeline + bulk verification
     and its own scheduling (replaces agent-side verification; runs next to the data).
   - **pgcrypto** for DB-side hashing if you want audit hashes near the data.
   - A single **audit-append trigger** on `workspace_state` (cheap, no JSON diff).
4. Keep `document` writes in the app (CAS) as the source of truth unless/until you
   commit to relational.

---

## 6. Suggested next step (pick one)

- **(A) Capability now:** prototype a **Neon Function** that runs the bulk Reoon verify
  (and LimaData find) pipeline and writes `domain_verified`/`email_verified` back —
  decouples external calls from the Render app.
- **(B) Strategic unlock:** design the **relational migration** (`document` →
  `leads`/`contacts` tables) that turns on intent triggers + Neon Realtime. Larger
  effort; changes the concurrency model.

(B) is what makes most of the above possible; (A) is the fastest concrete capability
gain and is independent of (B).
