-- 0001_exa_context_engine.sql
-- Blueprint migration for the vertical-aware EXA context engine.
-- Part of the relational enrichment pipeline (see docs/ENRICHMENT-AUTOMATION-ARCHITECTURE.md
-- and docs/WORKSPACE-STATE-RELATIONAL-DESIGN.md).
--
-- STATUS: NOT applied. This is a design artifact for the Phase-2 relational path.
-- It REQUIRES the base relational tables (leads, projects, contacts, enrichment_jobs)
-- to exist first — it does not run against the live single-document workspace_state DB.
-- Target: Neon Postgres 18.6. Do not run against prod until Phase 2 lands.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Vertical taxonomy — data-driven so a new workplace is an INSERT, not code.
--    role_titles/synonyms/match_terms are per-vertical JSON so each industry
--    carries its OWN executive vocabulary (a hospital's C-suite != a fund's).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verticals (
  key          text PRIMARY KEY,
  label        text NOT NULL,
  role_titles  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"c_suite":[..],"director":[..],"decision_maker":[..]}
  synonyms     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- query-expansion terms for recall
  match_terms  jsonb NOT NULL DEFAULT '[]'::jsonb,   -- category/description substrings that map a lead here
  updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO verticals (key, label, role_titles, synonyms, match_terms) VALUES
('energy','Energy / Hydrogen',
 '{"c_suite":["CEO","CFO","COO","CTO","Chief Industry Officer","Chief Commercial Officer","Chief Strategy Officer"],
   "director":["Director","Head of Hydrogen","Head of Power-to-X","VP Business Development","Project Director","Managing Director"],
   "decision_maker":["Head of Project","Country Manager","VP Operations","Business Development Lead"]}'::jsonb,
 '["hydrogen","electrolysis","Power-to-X","green ammonia","e-fuels","renewable energy","electrolyzer","offtake"]'::jsonb,
 '["energy","hydrogen","renewable","power","utility","solar","wind"]'::jsonb),
('technology','Technology / Software',
 '{"c_suite":["CEO","CTO","CPO","CRO","CISO","COO","CFO"],
   "director":["VP Engineering","Director of Product","Head of Data","Engineering Director","VP R&D"],
   "decision_maker":["Head of Technology","Product Lead","R&D Director","Platform Lead"]}'::jsonb,
 '["software","SaaS","AI","platform","cloud","engineering","product"]'::jsonb,
 '["technology","software","saas","digital","ai","it"]'::jsonb),
('finance','Finance / Investment',
 '{"c_suite":["CEO","CFO","CIO","CRO","COO","Chief Risk Officer","Chief Investment Officer"],
   "director":["Head of Investment","Director of Finance","VP Treasury","Head of M&A","Controller"],
   "decision_maker":["Investment Director","Fund Manager","Head of Capital Markets","Deal Principal"]}'::jsonb,
 '["investment","capital","treasury","M&A","private equity","asset management","financing"]'::jsonb,
 '["finance","financial","bank","investment","fund","insurance"]'::jsonb),
('real_estate','Real Estate / Property',
 '{"c_suite":["CEO","CFO","COO","Chief Investment Officer","Chief Development Officer"],
   "director":["Head of Acquisitions","Asset Manager","Development Director","Head of Leasing"],
   "decision_maker":["Regional Director","Transaction Manager","Fund Principal","Development Manager"]}'::jsonb,
 '["real estate","property","development","acquisitions","asset management","leasing","REIT"]'::jsonb,
 '["real estate","property","construction","reit","development"]'::jsonb),
('health','Healthcare / Life Sciences',
 '{"c_suite":["CEO","Chief Medical Officer","CNO","COO","CFO","Chief Scientific Officer"],
   "director":["Clinical Director","Medical Director","Director of Operations","Head of Research"],
   "decision_maker":["Department Head","Chief of Staff","Research Lead","Site Director"]}'::jsonb,
 '["healthcare","clinical","patient","medical","pharmaceutical","trials","hospital"]'::jsonb,
 '["health","healthcare","medical","pharma","clinical","biotech"]'::jsonb),
('manufacturing','Manufacturing / Industrial',
 '{"c_suite":["CEO","COO","CTO","CFO","Chief Supply Chain Officer"],
   "director":["Plant Manager","Director of Operations","Head of Production","Engineering Director"],
   "decision_maker":["Operations Manager","Head of Procurement","VP Manufacturing","Site Manager"]}'::jsonb,
 '["manufacturing","production","plant","supply chain","industrial","fabrication"]'::jsonb,
 '["manufacturing","industrial","production","factory","plant"]'::jsonb)
ON CONFLICT (key) DO UPDATE
  SET label=excluded.label, role_titles=excluded.role_titles,
      synonyms=excluded.synonyms, match_terms=excluded.match_terms, updated_at=now();

-- ---------------------------------------------------------------------------
-- 2) leads.vertical — auto-detected on insert, human-pinnable afterward.
--    (Trigger only fills when NULL, so a manual correction always wins.)
-- ---------------------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS vertical text REFERENCES verticals(key);

-- ---------------------------------------------------------------------------
-- 3) enrichment_jobs — persist the decomposed context parts (inspectable),
--    the rendered request, and the raw response.
-- ---------------------------------------------------------------------------
ALTER TABLE enrichment_jobs
  ADD COLUMN IF NOT EXISTS context  jsonb,
  ADD COLUMN IF NOT EXISTS request  jsonb,
  ADD COLUMN IF NOT EXISTS response jsonb;

-- ---------------------------------------------------------------------------
-- 4) helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION jsonb_to_textarr(j jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(e), '{}'::text[])
  FROM jsonb_array_elements_text(coalesce(j, '[]'::jsonb)) e;
$$;

CREATE OR REPLACE FUNCTION detect_vertical(p_category text, p_description text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT v.key
  FROM verticals v
  WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v.match_terms) m
    WHERE lower(coalesce(p_category,'')||' '||coalesce(p_description,'')) LIKE '%'||lower(m)||'%'
  )
  ORDER BY (
    SELECT count(*) FROM jsonb_array_elements_text(v.match_terms) mm
    WHERE lower(coalesce(p_category,'')||' '||coalesce(p_description,'')) LIKE '%'||lower(mm)||'%'
  ) DESC, v.key
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 5) auto-populate vertical for existing rows (idempotent; respects pins)
-- ---------------------------------------------------------------------------
UPDATE leads
   SET vertical = detect_vertical(category, description)
 WHERE vertical IS NULL;

-- ---------------------------------------------------------------------------
-- 6) builder — one vertical-aware EXA request per role_class (the "parts").
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION build_exa_request(p_lead uuid, p_role_class text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  l leads; proj projects; v verticals; roles text[]; syn text[]; ctx_key text;
BEGIN
  SELECT * INTO l FROM leads WHERE id = p_lead;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead % not found', p_lead; END IF;
  SELECT * INTO proj FROM projects WHERE id = l.project_id;

  ctx_key := coalesce(l.vertical, detect_vertical(l.category, l.description));
  SELECT * INTO v FROM verticals WHERE key = ctx_key;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','no_vertical_resolved','lead',p_lead,'resolved',ctx_key);
  END IF;

  roles := jsonb_to_textarr(v.role_titles -> p_role_class)
           || jsonb_to_textarr(proj.targeting -> 'roles');
  roles := ARRAY(SELECT DISTINCT unnest(roles) WHERE unnest IS NOT NULL);
  syn   := jsonb_to_textarr(v.synonyms);

  RETURN jsonb_build_object(
    'context', jsonb_build_object(
      'identity',   jsonb_build_object('name',l.name,'domain',l.domain,'country',l.country,'city',l.city),
      'vertical',   v.key,
      'role_class', p_role_class,
      'roles',      to_jsonb(roles),
      'lexicon',    to_jsonb(syn)
    ),
    'request', jsonb_build_object(
      'query',      'category:people '||array_to_string(roles,' | ')||' at '||l.name,
      'type',       'neural',
      'category',   'people',
      'numResults', 20,
      'contents',   jsonb_build_object('text', true),
      'objective',  'Find CURRENT '||array_to_string(roles,', ')||' of '||l.name
                    ||' ('||coalesce(l.domain,'')||', '||coalesce(l.country,'')||').'
                    ||' Widen with: '||array_to_string(syn,', ')||'.'
                    ||' Return full name, exact current title, and linkedin.com/in URL.'
                    ||' Exclude anyone whose '||l.name||' role has an end date or who now works elsewhere.'
    )
  );
END $$;

-- fan out: one part per role group (multi-query recall recipe)
CREATE OR REPLACE FUNCTION build_exa_requests(p_lead uuid)
RETURNS SETOF jsonb LANGUAGE sql STABLE AS $$
  SELECT build_exa_request(p_lead, rc)
  FROM unnest(ARRAY['c_suite','director','decision_maker']) rc;
$$;

-- ---------------------------------------------------------------------------
-- 7) trigger — auto-set vertical on new/changed leads, only when not pinned
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_lead_vertical() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.vertical IS NULL THEN
    NEW.vertical := detect_vertical(NEW.category, NEW.description);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS t_lead_vertical ON leads;
CREATE TRIGGER t_lead_vertical BEFORE INSERT OR UPDATE OF category, description ON leads
  FOR EACH ROW EXECUTE FUNCTION trg_lead_vertical();

COMMIT;

-- Usage (worker side, NOT in SQL):
--   SELECT jsonb_array_elements(build_exa_requests(lead_id)) -> 'request'  -- per part
--   -> POST each .request to https://api.exa.ai/search (x-api-key) -> store .response
--   -> apply_exa_response(job) parses results into contacts (next migration).
