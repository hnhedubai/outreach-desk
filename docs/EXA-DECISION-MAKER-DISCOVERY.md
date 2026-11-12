# EXA-Based Decision-Maker Discovery — Maximizing VERIFIED Results

How to pull C-suite / directors / decision-makers (name + designation + LinkedIn URL)
using the EXA API and turn raw hits into *verified* contacts. Grounded in a live
`category:people` run against Lhyfe (2026-11-12), which both shows the yield and the
stale-data trap.

EXA surface (verified): `web_search_exa(query, numResults, objective)` — semantic
search with `category:people` (LinkedIn corpus) and `category:company`; `web_fetch_exa(urls[], maxCharacters)` — batch full-page reads.

---

## 1. What EXA actually returns (from the Lhyfe run)

One query returned, per person: **name, headline, `linkedin.com/in/...` URL, current
role at the company with a "(Current)" flag + start/end dates, department, seniority
level (`C-Level`, `Director`, `President/Vice President`, `Executive`), and recent
posts.** That is discovery + designation + URL in a single call — no dedicated people
API needed.

Yield example (Lhyfe): Philippe Desorme (Vice CEO), Nolwenn Belléguic (Co-founder &
Deputy CEO), Maria Pardo Saleme (CFO, Board), Olivier Magaud (COO), Emmanuel Chemineau
(Chief Industry Officer), Bruno Le Jossec (Board).

**The trap, live:** it also returned Maylis Brault-Lasnel as "CFO – Lhyfe," but her
profile shows that role **ended Sep 2026** and her current role is at another company
(2CFinance). A naive scrape would have added a departed exec. Verification is exactly
the step that catches this.

---

## 2. Strategy to MAXIMIZE verified results

### A. Query design (coverage)
- Use `category:people` + a **page-like description**, not keywords, e.g.
  `"category:people executive leadership team and board of directors of <Company>"`.
- **Run several targeted queries per company**, not one:
  - C-suite: `"CEO CFO COO CTO of <Company>"`
  - Board: `"board of directors members of <Company>"`
  - Domain decision-makers: `"head of hydrogen / VP business development of <Company>"`
  - Regional: add the operating country/language (titles differ by market).
- Raise `numResults` (e.g. 15–30) to widen recall, then filter hard.
- Use the **`objective`** field to bias ranking AND state the currentness rule:
  *"Return only people whose CURRENT role is at <Company>; exclude anyone whose
  <Company> role has an end date or who now works elsewhere; pull full name, exact
  title, and linkedin.com/in URL."*

### B. The currentness filter (the #1 accuracy lever)
For each hit, from the highlights:
1. Keep the role **only if** the `<Company>` entry is marked **(Current)** AND has no
   end date (i.e. `- Present`).
2. Reject if a **more recent** role at a different company exists (Maylis case).
3. Prefer the profile whose **headline** still names the company.

### C. Corroborate the designation (2-source rule)
EXA titles can be self-styled or stale (e.g. founder shows "Chief Visionary Officer"
not "CEO"). Confirm each keeper against an authoritative source:
- `web_fetch_exa` the company's `/team`, `/leadership`, `/about`, `/investors` page,
  and/or `web_search_exa` a press release naming that person + title.
- Accept the title from the **company page** when it conflicts with the LinkedIn headline.

### D. Disambiguate same-name people
Match on **company + location + seniority level + department**; require ≥2 agreeing
fields. If ambiguous, drop or flag — never guess.

### E. Upgrade to a VERIFIED *contact* (name → reachable)
EXA gives identity, not reliable emails. Complete the loop with the existing pipeline:
1. Verified name + company domain → **LimaData `find_work_email`** (1cr) → work email
   (domain-match guard enforces "work email only").
2. **Reoon `/verify?mode=power`** (1cr) → `safe/invalid/catch_all/...`.
3. Persist with `discovery_source='exa'` (fits the pipeline doc's contacts columns).

---

## 3. Confidence tiers (report every result as one)

| Tier | Criteria | Meaning |
|---|---|---|
| **Found** | EXA profile: name + title + LinkedIn URL, role marked Current | likely, uncorroborated |
| **Confirmed** | Found + title matches company page/press + still in role | identity verified |
| **Verified** | Confirmed + work email domain-matched + Reoon `safe` | reachable & verified |

Only promote to the outreach list at **Confirmed**+; email is the **Verified** step.
This makes "maximum verified" measurable: maximize the Confirmed/Verified tiers, not
raw hits.

---

## 4. Concrete per-company recipe

1. 3–4 EXA `category:people` queries (C-suite, board, function leads) with the
   currentness `objective`. numResults 15–30.
2. Parse highlights → keep (Current, no end date, headline names company).
3. `web_fetch_exa` the company leadership page once → reconcile titles + catch
   people EXA missed.
4. Dedup by `linkedin.com/in` URL; disambiguate names.
5. For each Confirmed person → LimaData find_work_email → Reoon verify → Verified.
6. Store `{name, title, linkedinUrl, role_class, discovery_source='exa',
   email, email_status, email_verified, verified_at}`.

---

## 5. Why this beats "no-API" and complements LimaData

- vs **manual web search**: EXA returns structured LinkedIn profiles directly
  (name/title/URL/level/currentness) — far higher recall per call, no `site:` scraping.
- vs **LimaData `db_search_people`**: EXA often finds people LimaData's index lacks
  (regional, newer hires, board members) and gives the LinkedIn URL + evidence to
  corroborate. Best result = **union of both**, then dedup + verify. EXA = discovery
  breadth + proof; LimaData = structured enrichment; Reoon = deliverability verdict.

---

## 6. Limits to respect
- EXA reflects the **crawled** LinkedIn snapshot (dates shown are crawl freshness) —
  still can lag reality; the currentness + 2-source rules mitigate but don't eliminate.
- EXA does not verify emails/deliverability — that's Reoon's job.
- Titles are self-reported; always reconcile with the company page.
- Cost is per search, not per person — batch queries and fetches to control spend.
