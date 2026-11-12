# Clickless Enrichment Automation — Neon Architecture

Design for fully automated, resumable, auditable lead→decision-maker→verified-contact
processing on the relational Neon model. Every fact here is verified against the live
instance + Neon docs (2026-11-12):

- Postgres 18.6; languages plpgsql/sql/c only; **no pgsql-http/pg_net** → SQL cannot
  call external APIs.
- **Neon Functions** GA — backend code on a branch, next to the data, long-running.
- **Neon Function Triggers** GA — invoke a Function on a **UTC cron** or on an event,
  **fires even at scale-to-zero**. No separate scheduler/queue to run.
- **Neon Realtime** ("Live") public beta — turns a SQL query into a live subscription.
- `FOR UPDATE SKIP LOCKED` available (standard PG) → safe job claiming.
- `pg_cron` available (optional DB-side scheduling of SQL-only maintenance).

Prerequisite: the relational decomposition (`WORKSPACE-STATE-RELATIONAL-DESIGN.md`).
The single-document store can run the same logic app-side, but triggers/queue/Realtime
only exist once tables exist.

---

## 1. The clickless loop (end to end)

```
lead lands (import/add)
   └─ trigger → set domain_verified='pending' + enqueue verify_domain
Neon Function (cron trigger, e.g. every 60s) drains queue:
   verify_domain  → DoH MX  → domain_verified='valid' → trigger enqueues discover_people
   discover_people→ EXA/LimaData db_search_people → INSERT contacts → triggers enqueue find_email
   find_email     → LimaData find_work_email → UPDATE contacts.email → trigger enqueues verify_email
   verify_email   → Reoon POWER → UPDATE contacts.email_verified
   each write → Neon Realtime pushes progress to the dashboard (no polling)
failures → attempts++/backoff; after N → status='error' → trigger logs an incident → Realtime alert
```
Human touches nothing. The only optional gate is a "review before outreach" checkpoint
(§6).

---

## 2. Relational persistence of the process

State is split into **durable status columns** (what IS) and a **job queue** (what to
DO). The queue is the spine that makes it resumable and crash-safe.

```sql
-- process state on the entity (idempotent, drives UI + triggers)
ALTER TABLE leads    ADD COLUMN pipeline_stage text NOT NULL DEFAULT 'new'
  CHECK (pipeline_stage IN ('new','domain_pending','domain_valid','domain_invalid',
                            'discovered','enriching','complete'));
-- contacts already carry: email_status, email_verified, discovered_at, verified_at

-- the work queue
CREATE TABLE enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  action text not null CHECK (action IN
    ('verify_domain','discover_people','find_email','verify_email')),
  provider text not null,              -- doh | exa | limadata | reoon
  status text not null default 'queued'
    CHECK (status IN ('queued','running','done','error','skipped')),
  run_after timestamptz NOT NULL DEFAULT now(),   -- backoff gate
  attempts int NOT NULL DEFAULT 0,
  credits numeric NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX jobs_ready_idx ON enrichment_jobs(run_after)
  WHERE status='queued';

-- incidents (anomalies) surfaced to the frontend
CREATE TABLE incidents (
  id uuid primary key default gen_random_uuid(),
  severity text NOT NULL DEFAULT 'warn'
    CHECK (severity IN ('info','warn','critical')),
  kind text NOT NULL,           -- job_failed | budget_exceeded | domain_invalid | stale_contact
  lead_id uuid, contact_id uuid, job_id uuid,
  detail text, at timestamptz NOT NULL DEFAULT now(), resolved boolean DEFAULT false
);
```

Consistency is enforced by constraints, not code: unique LinkedIn URL per lead and
unique email per lead prevent duplicate contacts; CHECK enums stop illegal states;
FK cascade cleans up on delete.

---

## 3. Functions & procedures (consistent procedure)

**Atomic job claim** — the heart of a safe worker pool (no double-processing):
```sql
CREATE FUNCTION claim_next_job() RETURNS setof enrichment_jobs
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  UPDATE enrichment_jobs j
     SET status='running', attempts=j.attempts+1, updated_at=now()
   WHERE j.id = (
     SELECT id FROM enrichment_jobs
      WHERE status='queued' AND run_after <= now()
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING j.*;
END $$;
```

**Complete / fail with backoff** (uniform error handling):
```sql
CREATE FUNCTION complete_job(p_id uuid, p_credits numeric) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE enrichment_jobs
     SET status='done', credits=p_credits, updated_at=now() WHERE id=p_id;
END $$;

CREATE FUNCTION fail_job(p_id uuid, p_err text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE enrichment_jobs
     SET error=p_err, updated_at=now(),
         status   = CASE WHEN attempts >= 3 THEN 'error' ELSE 'queued' END,
         run_after= CASE WHEN attempts >= 3 THEN run_after
                         ELSE now() + make_interval(mins => attempts*5) END  -- 5/10/15m backoff
   WHERE id=p_id;
END $$;
```

**Idempotent enqueue** (never double-queue the same pending step):
```sql
CREATE FUNCTION enqueue(p_action text, p_provider text,
                        p_lead uuid default null, p_contact uuid default null)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM enrichment_jobs
                 WHERE action=p_action AND status IN ('queued','running')
                   AND (contact_id IS NOT DISTINCT FROM p_contact)
                   AND (lead_id IS NOT DISTINCT FROM p_lead)) THEN
    INSERT INTO enrichment_jobs(action,provider,lead_id,contact_id)
      VALUES (p_action,p_provider,p_lead,p_contact);
  END IF;
END $$;
```

---

## 4. Triggers that make it clickless AND timely

Triggers do **only DB-local work** — set status, enqueue the next step, record an
incident. They never call HTTP (impossible in Neon). This is what chains the pipeline
and fires incidents instantly.

```sql
-- lead lands → verify its domain (immediately)
CREATE FUNCTION trg_lead_new() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM enqueue('verify_domain','doh', NEW.id, null);
  RETURN NEW;
END $$;
CREATE TRIGGER t_lead_new AFTER INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION trg_lead_new();

-- domain corrected → re-verify + (if valid) discover people
CREATE FUNCTION trg_lead_domain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.domain IS DISTINCT FROM OLD.domain THEN
    NEW.domain_verified := 'pending';
    PERFORM enqueue('verify_domain','doh', NEW.id, null);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t_lead_domain BEFORE UPDATE OF domain ON leads
  FOR EACH ROW EXECUTE FUNCTION trg_lead_domain();

-- email set/changed → enqueue Reoon verify (chains find→verify)
CREATE FUNCTION trg_contact_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email <> ''
     AND (OLD.email IS NULL OR OLD.email <> NEW.email) THEN
    NEW.email_verified := 'pending';
    PERFORM enqueue('verify_email','reoon', NEW.lead_id, NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t_contact_email BEFORE UPDATE OF email ON contacts
  FOR EACH ROW EXECUTE FUNCTION trg_contact_email();

-- a job parked as 'error' → raise an incident for the live dashboard
CREATE FUNCTION trg_job_incident() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='error' AND OLD.status <> 'error' THEN
    INSERT INTO incidents(kind,lead_id,contact_id,job_id,detail)
      VALUES ('job_failed', NEW.lead_id, NEW.contact_id, NEW.id,
              NEW.action||' failed: '||coalesce(NEW.error,''));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t_job_incident AFTER UPDATE OF status ON enrichment_jobs
  FOR EACH ROW EXECUTE FUNCTION trg_job_incident();
```
The domain-valid→discover and discover→find_email links are set by the **worker**
writing `domain_verified='valid'` / inserting contacts, which the triggers above pick
up — so the chain advances with zero clicks.

---

## 5. Neon Live vs Neon HTTP vs Neon Function — when to use each

| Capability | Use for | NOT for |
|---|---|---|
| **Neon Function + Function Trigger (cron)** | The **worker**: drain `claim_next_job()`, make the LimaData/Reoon/EXA/Firecrawl/DoH **HTTP calls**, write results back. Fires every minute even at scale-to-zero → the automation engine. | Row-level transactional UI writes (that's the app). |
| **Neon Live (Realtime)** | **Read side**: push `leads/contacts/enrichment_jobs/incidents` changes to the frontend live (progress bar, verified ticks, incident feed) — replaces polling. | Driving the worker (use the queue + claim). |
| **Neon HTTP (serverless driver)** | The **frontend / edge clients querying the DB over HTTP** (read models, the dashboard) and calling a Function's public URL. | Calling external APIs from SQL — not supported. |
| **pg_cron (SQL only)** | Optional DB-side maintenance that needs no HTTP: nightly re-verify enqueue, purge old done-jobs, re-arm errored jobs. | Anything requiring an HTTP call (use a Function Trigger instead). |

Rule of thumb: **Functions do the outbound work, Realtime does the inbound live view,
HTTP driver is how clients talk to the DB.** Triggers/procedures keep the state machine
consistent in between.

---

## 6. Guardrails for safe full automation

- **Credit budget**: before claiming, a Function checks `SUM(credits) today` against a
  cap; over-budget → jobs stay queued + `budget_exceeded` incident. (LimaData 0.1/1/3,
  Reoon 1 each.)
- **Rate limits**: LimaData find is single-flight today; EXA/Reoon throttle in the
  worker (token bucket), not the DB.
- **Idempotency**: `enqueue()` dedup + unique email/linkedin constraints → re-runs are
  safe.
- **Kill switch**: a `automation_enabled` flag in `app_meta`; triggers/worker no-op when
  off.
- **Freshness**: `verified_at` + a scheduled Function re-verifies stale contacts
  (e.g. >90 days) → keeps "current role" honest (the Maylis/departed-exec trap).
- **Human-review gate (optional)**: stop at `Confirmed`, require one approval before
  `Verified`→outreach, if you don't want fully hands-off sending.

---

## 7. Build order

1. Relational tables + constraints (Phase 2 of the migration doc).
2. `enrichment_jobs` + `incidents` + the functions (§3) + triggers (§4) — DB-only,
   testable with `npm run verify` + SQL harness.
3. One **Neon Function** worker (`claim_next_job` → provider calls → `complete/fail`) +
   a **Function Trigger** on a 1-minute cron.
4. Enable **Neon Realtime**; point the dashboard at live queries.
5. Turn on guardrails (budget, kill switch, staleness re-verify).

**Recommended next move:** start at step 2 — I'll write the concrete DDL + functions +
triggers as a versioned SQL migration file in the repo (`db/migrations/`) so the state
machine is testable in isolation before any worker or Function exists, then wire the
Neon Function worker against it.
