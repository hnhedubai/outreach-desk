# Contact Enrichment Pipeline → Relational Neon Model (Deep Dive)

Maps the full workflow — domain verify → discover decision-makers (names +
designations + LinkedIn) → LimaData work-email → Reoon verify — onto the relational
schema in `WORKSPACE-STATE-RELATIONAL-DESIGN.md`. Tool capabilities/costs verified
live against the LimaData + Reoon APIs 2026-11-12.

---

## 1. The end-to-end pipeline (5 stages)

1. **Domain gate** — a lead is only enriched once `leads.domain_verified='valid'`
   (green tick). If missing/invalid → Firecrawl to find the real domain (existing).
2. **Discover people** — LimaData `db_search_people` filtered by
   `org_domain = lead.domain` AND `job_level` in the executive enum OR `job_title`
   containing `Chief|Director|VP|Head|Founder|President`. Returns
   `full_name`, `job_title`, `linkedin` (profile URL). → creates `contacts` rows.
   *Fallback:* Exa/Firecrawl web search for names+LinkedIn when LimaData misses (the
   old ChatGPT path) — but LimaData usually covers it, cheaper.
3. **Find work email** — per contact:
   - `find_work_email(full_name, lead.domain)` = **1 credit** (only charged on hit),
     OR `find_work_email_from_linked_in(linkedin)` = **3 credits** (self-resolves the
     company+domain). Prefer name+domain (1cr) since we already have a verified domain;
     use the LinkedIn variant only when the domain is uncertain.
4. **Verify** — Reoon `/verify?email=&mode=power` = **1 credit** → valid/invalid/
   catchall/unknown.
5. **Display** — per-contact pipeline status + the domain green tick + verified badge.

**Key finding:** the ChatGPT "web-search names + LinkedIn first" step is now mostly
redundant — `db_search_people` yields names, designations *and* LinkedIn URLs straight
from the domain, at 0.1/record. Keep web search only as a gap-filler.

---

## 2. "Work emails only" — how it's enforced

LimaData `find_work_email` returns the *work* email for the domain; the app's
`classifyLimaResult` already rejects any email whose domain isn't the company domain
(or a subdomain) → outcome `invalid_result`. That domain-match **is** the work-email
guarantee (it structurally excludes gmail/yahoo/hotmail/icloud/proton, since those
aren't the company domain). Keep that check as the hard gate; optionally add a
free-mail blocklist as a second belt (defense in depth) but it's not strictly needed.

---

## 3. Schema additions (on top of the relational design)

### `contacts` — add pipeline columns
```sql
ALTER TABLE contacts ADD COLUMN role_class text
  CHECK (role_class IN ('c-suite','director','decision-maker','other'));
ALTER TABLE contacts ADD COLUMN discovery_source text;   -- limadata|web_search|manual|import
ALTER TABLE contacts ADD COLUMN discovered_at timestamptz;
ALTER TABLE contacts ADD COLUMN email_status text        -- the FIND step (separate from verify)
  CHECK (email_status IN ('pending','found','not_found','error'));
ALTER TABLE contacts ADD COLUMN email_found_at timestamptz;
-- existing: email, email_source, linkedin, email_verified, verified_at, verify_source
```
`email_status` (did we find one?) is distinct from `email_verified` (Reoon result).
`linkedin` already exists (the profile URL).

### New: `enrichment_jobs` — the work queue the pipeline runs on
```sql
CREATE TABLE enrichment_jobs (
  id text primary key,
  contact_id text references contacts(id) on delete cascade,
  lead_id text references leads(id) on delete cascade,
  action text not null check (action in
    ('discover_people','find_email','verify_email')),
  provider text not null,          -- limadata | reoon | firecrawl | exa
  status text not null default 'queued'
    check (status in ('queued','running','done','error','skipped')),
  credits numeric default 0,       -- actual spend recorded
  error text,
  attempts int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz
);
CREATE INDEX jobs_pending_idx ON enrichment_jobs(status, created_at)
  WHERE status='queued';
```
This makes the pipeline a durable, resumable, auditable queue with credit accounting.

---

## 4. WHERE each step runs (the constraint that shapes everything)

**Neon SQL cannot make HTTP calls** (no pgsql-http / pg_net — verified). So no
function/trigger/procedure can call LimaData, Reoon, Firecrawl, or Exa. The split is:

- **DB (triggers/functions)** = mark intent + enqueue. Cheap, synchronous, no network.
- **Worker (Node app OR a Neon Function)** = dequeue a job, make the HTTP call, write
  the result back, update status + credits. This is the only place APIs are called.
- **Neon Realtime** = push `contacts`/`enrichment_jobs` changes to the frontend live.

Choose worker home:
- **In-app (Render Node):** simplest — reuse existing `research-providers.mjs`
  (`findLimaEmail`, `classifyLimaEmail`), add `findPeople`, `findEmailFromLinkedIn`,
  `verifyReoonEmail`. One codebase, one deploy.
- **Neon Function:** decoupled, next to the data, scales for bulk; good if you want
  enrichment to run independent of the web app. More infra + a second deploy path.

---

## 5. The OO loop (trigger → worker → realtime)

```
1. Discover:      db_search_people(domain) → INSERT contacts(role_class,
                  discovery_source='limadata', email_status='pending')
                  + INSERT enrichment_jobs(action='find_email', status='queued')
2. Trigger marks:  AFTER INSERT/UPDATE OF email ON contacts
                     → NEW.email_verified:='pending'; enqueue verify_email job
3. Worker finds:   dequeue find_email → find_work_email(name,domain)
                     → UPDATE contacts SET email=..., email_status='found'
                       (or 'not_found'/'error'); record credits
4. Worker verifies:dequeue verify_email → Reoon power →
                     UPDATE contacts SET email_verified='valid'/'invalid'/...
5. Realtime:       frontend subscribes per project → progress updates live, no polling
```

Example enqueue trigger (intent-based, no HTTP):
```sql
CREATE FUNCTION contact_email_changed() RETURNS trigger AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email <> '' AND
     (OLD.email IS NULL OR OLD.email <> NEW.email) THEN
    NEW.email_verified := 'pending';
    INSERT INTO enrichment_jobs(id,contact_id,lead_id,action,provider)
      VALUES (gen_random_uuid()::text, NEW.id, NEW.lead_id,'verify_email','reoon');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_contact_email AFTER UPDATE OF email ON contacts
  FOR EACH ROW EXECUTE FUNCTION contact_email_changed();
```
(`gen_random_uuid()` needs no extension in PG18 — it's built in.)

---

## 6. Credit accounting & pools

- LimaData: 0.1/person (db_search_people), 1/email (find_work_email), 3/LinkedIn-email.
- Reoon: 1/verify (POWER). Two pools (daily + instant).
- ColdIQ and LimaData are **separate** credit pools — don't mix budgets.
- `enrichment_jobs.credits` records actual spend per job → sum for cost-per-lead and
  a live burn-down. Balance pre-check before each worker batch (mirror the existing
  `LIMA_EMAIL_LOOKUP_COST` gate).

---

## 7. Fit assessment (system-engineer view)

- **Strong fit:** the relational model + `enrichment_jobs` queue + triggers is a clean
  home for this pipeline — resumable, auditable, credit-metered, and Realtime-pushable.
- **Prerequisite:** this design assumes the relational decomposition (Phase 2 of the
  migration doc) is done. On the current single-document store, the pipeline can only
  run app-side with the status fields living inside the JSON blob (no triggers/queue).
- **Keep in the app/function, not the DB:** all HTTP (API calls), classification,
  free-mail/domain guards. Keep in the DB: state, intent, queue, accounting, realtime.

---

## 8. Next step

Two-track, in order:
1. **Now (works today, no schema change):** build the pipeline **app-side** against the
   existing document store — `findPeople` (db_search_people), reuse `findLimaEmail`,
   add `verifyReoonEmail`, with a `contacts[]` pipeline status object per lead. Proves
   the flow end-to-end and the credit math.
2. **Once relational lands (Phase 2):** port the same worker to consume
   `enrichment_jobs` from tables, add the triggers, enable Neon Realtime.

**Recommended next move:** start track 1 — I'll spec the three provider functions
(`findPeople`, `verifyReoonEmail`, and the `find_work_email` path) plus the per-contact
pipeline status shape, as tested additions to `research-providers.mjs`, so the whole
discover→find→verify loop runs now and is ready to move onto the relational queue later.
