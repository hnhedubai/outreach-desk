# Relational Decomposition of `workspace_state` — Design & Migration Plan

Goal: replace the single-document `workspace_state(id, revision, document text)` with
normalized tables, so that intent-based triggers, fine-grained functions, and Neon
Realtime (per-record live push) become possible. Grounded in the live document shape
and cardinalities verified 2026-11-12 (1 workspace / 2 projects / 49 leads / 77
contacts / 20 assignments / 129 history / 129 audit / 2 imports / 1 member).

> This is a DESIGN. Nothing here mutates prod. Implementation is phased (§5) and the
> hard part is the concurrency-model change (§4), not the DDL.

---

## 1. Entity map (document path → table)

| Document path | Table | PK / notes |
|---|---|---|
| `active` | `app_meta` (1 row) | active workspace id |
| `workspaces[]` | `workspaces` | id |
| `workspaces[].cookie`/`exports` | `workspaces.settings jsonb` | low-value maps, keep jsonb |
| `workspaces[].members[]` | `members` | id → workspace_id |
| `workspaces[].suppressions[]` | `suppressions` | id → workspace_id |
| `workspaces[].audit[]` | `audit` | id → workspace_id |
| `workspaces[].searches[]` | `searches` (scope='workspace') | id |
| `projects[]` | `projects` | id → workspace_id |
| `projects[].quotas`/`targeting` | `projects.quotas/targeting jsonb` | stable maps, keep jsonb |
| `projects[].configs` (6 channels) | `channel_configs` | (project_id, channel) |
| `projects[].mailboxes[]` | `mailboxes` | id → project_id |
| `projects[].imports[]` | `imports` | id(batchId) → project_id |
| `projects[].searches[]` | `searches` (scope='project') | id |
| `projects[].enrichments[]` | `enrichments` | id → project_id |
| `projects[].assignments[]` | `assignments` | id → project_id, lead_id |
| `projects[].history[]` | `history` | id → project_id, lead_id |
| `projects[].leads[]` | `leads` | id → project_id |
| `leads[].channels` (map) | `lead_channels` | (lead_id, channel) |
| `leads[].contacts[]` | `contacts` | id → lead_id |
| `leads[].notes[]` | `notes` | id → lead_id |
| `leads[].drafts` (map) | `lead_drafts` | (lead_id, channel) |

Design rule: **entities that need triggers/realtime per record** (leads, contacts,
assignments, notes) get real columns; **stable config maps** (targeting, quotas,
configs, channels, drafts) either become small child tables with composite PKs or stay
`jsonb`. IDs stay `text` (existing uuids) for traceability.

---

## 2. Target DDL (Postgres 18, Neon)

```sql
CREATE TABLE app_meta (
  id smallint primary key check (id=1),
  active text
);

CREATE TABLE workspaces (
  id text primary key,
  name text not null,
  timezone text,
  settings jsonb not null default '{}'::jsonb   -- cookie, exports
);

CREATE TABLE members (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text, role text, email text, phone text, status text, timezone text
);

CREATE TABLE suppressions (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  channel text, handle text, added_at timestamptz
);

CREATE TABLE audit (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  type text, project text, lead_id text, channel text, email text,
  at timestamptz
);

CREATE TABLE projects (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null, split text, auto_assign boolean,
  global_cooldown int, max_leads int, last_generated_day text,
  created_at timestamptz,
  quotas jsonb not null default '{}'::jsonb,
  targeting jsonb not null default '{}'::jsonb
);

CREATE TABLE channel_configs (
  project_id text not null references projects(id) on delete cascade,
  channel text not null,
  enabled boolean, cap int, cooldown int, touches int, corporate boolean,
  priority text[] default '{}',
  primary key (project_id, channel)
);

CREATE TABLE mailboxes (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  channel text, email text, settings jsonb not null default '{}'::jsonb
);

CREATE TABLE leads (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  name text, domain text,
  domain_verified text check (domain_verified in
    ('valid','no_mx','not_found','error','pending')),
  domain_checked_at timestamptz,
  country text, city text, category text, description text, website text,
  lifecycle text, ltv int, segment text, score numeric,
  manual boolean default false, not_fit boolean default false,
  source text, added_at timestamptz, erased_at timestamptz
);
CREATE INDEX leads_project_idx ON leads(project_id);
CREATE INDEX leads_domain_idx  ON leads(domain);

CREATE TABLE lead_channels (
  lead_id text not null references leads(id) on delete cascade,
  channel text not null, handle text,
  primary key (lead_id, channel)
);

CREATE TABLE contacts (
  id text primary key,
  lead_id text not null references leads(id) on delete cascade,
  name text, title text, email text, email_source text, linkedin text, source text,
  -- future Reoon verification columns:
  email_verified text check (email_verified in
    ('valid','invalid','catchall','unknown','error','pending')),
  verified_at timestamptz, verify_source text
);
CREATE INDEX contacts_lead_idx  ON contacts(lead_id);
CREATE INDEX contacts_email_idx ON contacts(email);

CREATE TABLE notes (
  id text primary key,
  lead_id text not null references leads(id) on delete cascade,
  channel text, text text, author text, at timestamptz
);

CREATE TABLE lead_drafts (
  lead_id text not null references leads(id) on delete cascade,
  channel text not null, subject text, body text, at timestamptz,
  primary key (lead_id, channel)
);

CREATE TABLE assignments (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  lead_id text references leads(id) on delete cascade,
  channel text, day text, handle text, person text, assignee text, mailbox text,
  marks text[] default '{}', at timestamptz
);
CREATE INDEX assignments_lead_idx ON assignments(lead_id);

CREATE TABLE history (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  lead_id text, type text, at timestamptz
);

CREATE TABLE imports (
  id text primary key,               -- batchId
  project_id text not null references projects(id) on delete cascade,
  label text, batch_hash text, rows jsonb, at timestamptz
);

CREATE TABLE searches (
  id text primary key,
  scope text check (scope in ('workspace','project')),
  workspace_id text, project_id text,
  source text, query text, results jsonb, at timestamptz
);

CREATE TABLE enrichments (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  domain text, lead_id text, provider text, description text, source text, at timestamptz
);
```

---

## 3. What this unlocks (the payoff you asked about)

**Intent-based trigger** (now feasible because `domain` is a real column):
```sql
CREATE FUNCTION lead_domain_changed() RETURNS trigger AS $$
BEGIN
  IF NEW.domain IS DISTINCT FROM OLD.domain THEN
    NEW.domain_verified := 'pending';
    NEW.domain_checked_at := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lead_domain BEFORE UPDATE OF domain ON leads
  FOR EACH ROW EXECUTE FUNCTION lead_domain_changed();
```
→ any edit to a lead's domain auto-flags it for re-verification, in the DB, not the app.

**Neon Realtime:** `neon realtime enable`, then subscribe a live query per project —
the leads/contacts rows push individually (no whole-doc re-push, no polling).

**Read functions/views:** e.g. `SELECT domain_verified, count(*) FROM leads GROUP BY 1`
for the verification dashboard, without shipping the blob.

---

## 4. The hard part — concurrency model (READ THIS)

Today the app is **single-writer, optimistic-revision CAS** over one row: read whole
state → mutate in memory → `UPDATE ... WHERE revision = prev`. Normalizing to many
rows removes that one-row CAS. You must pick a replacement:

- **Option 1 — transactional writes (recommended):** wrap each action in a
  `BEGIN…COMMIT`; row-level locking handles conflicts. Drop the global `revision`.
  Simplest and correct for a small app.
- **Option 2 — per-row optimistic version:** add `version int` to hot tables; app
  `UPDATE … WHERE id=? AND version=?`. More code, only needed if you expect concurrent
  edits to the same record.

This is a real rewrite of `model.mjs` (reducer) + `server.mjs` (the `/api/action`
dispatch + `load/maintain`), and every frontend consumer that assumes `state.workspaces[0]…`
nested shape. That's the bulk of the effort — the DDL above is the easy 10%.

---

## 5. Phased migration (safe, reversible)

1. **Phase 0 — mirror (read-only, zero risk):** create the tables in a **Neon branch**
   (not prod), build an ETL that expands `document` into them (Postgres
   `jsonb_to_recordset` + lateral joins, or a Node script), load, and **validate**
   row counts + spot-checks against the doc. No app changes.
2. **Phase 1 — dual-read:** app still writes the document (unchanged CAS), but a
   nightly/`pg_cron` job re-syncs tables from the doc. Frontend can start reading the
   tables for non-critical surfaces (e.g. the verification dashboard). Proves parity.
3. **Phase 2 — flip writes:** replace the reducer path with transactional per-entity
   writes; document becomes optional/retired. This is the big PR; do it behind a branch
   + full test pass (`npm run verify`).
4. **Phase 3 — turn on triggers + Realtime:** add the intent triggers, enable Neon
   Realtime on the branch, subscribe the frontend.

Rollback at every phase ≤1 is trivial (tables are a mirror). Phase 2 is the point of
no easy return — gate it on Phase 1 parity being proven.

---

## 6. Open decisions before Phase 0 build

1. Concurrency: **transactional writes (Option 1)** vs per-row version (Option 2)?
2. How far to normalize the config maps (targeting/quotas/channels/drafts): child
   tables vs keep `jsonb`? (Recommend keep `jsonb` for these; normalize only the
   entities that need triggers/realtime.)
3. Where the ETL runs: pure SQL (`jsonb_to_recordset`) vs a Node script reusing
   `model.mjs` helpers (cleaner for validation logic).
