# Costing Calculator — Enrichment & Verification Pipeline

Durable cost model + live balance snapshot for the outreach pipeline. **Maintain this
file**: refresh the snapshot (bottom) whenever balances move, and update rates if a
provider reprices. "Keep an eye on costing" = re-check balances before any bulk run.

Snapshot date: **2026-11-12**

---

## 1. Live balance snapshot (pulled this session)

| Provider | Pool | Remaining | Notes |
|---|---|---|---|
| **LimaData** | credits | **592** | shared pool for people/email/phone lookups |
| **Reoon** | daily credits | **4** | near-empty today |
| **Reoon** | instant credits | **6,539** | the big pool — route verification here |
| **ColdIQ** | credits | **0.51** | ⚠ effectively EMPTY (used 849 this month, $0.0143/credit, personal, no Unlimited) |
| **EXA** | per-search | not a fixed balance | read `creditsUsed` from each API response; logs actuals |
| **Firecrawl** | per-search | — | 2 credits/search (no scrape), per `firecrawl.mjs:5` |

**Immediate call-outs:**
- Reoon **daily** pool is nearly out (4) — verification must use the **instant** pool (6,539).
- **ColdIQ is empty** — new sourcing there will fail; route sourcing to LimaData + EXA.
- **Phone enrichment is the budget risk** (see §4): 10 credits each, and LimaData can't
  fund phones for the whole Nordic project right now.

---

## 2. Rate table (verified against provider schemas/code)

| Action | Provider | Unit cost | Charged when |
|---|---|---|---|
| Discover people (db_search_people) | LimaData | **0.1 / record** | per record returned |
| Find work email (name+domain) | LimaData | **1 / email** | only on hit |
| Find work email (LinkedIn URL) | LimaData | **3 / email** | only on hit |
| Find phone (name+domain or LinkedIn) | LimaData | **10 / phone** | only on hit |
| Verify email (Reoon POWER) | Reoon | **1 / verify** | per call |
| Web search (domain discovery) | Firecrawl | **2 / search** | per search |
| People search (category:people) | EXA | per search + contents | read `creditsUsed` |

USD/credit known only for ColdIQ ($0.0143). For LimaData/Reoon/EXA/Firecrawl, cost in
**credits** is the actionable number — pull $/credit from each dashboard when needed.

---

## 3. Per-contact cost model

Let `h` = email hit-rate, `ph` = phone hit-rate (fractions).

```
email-only contact   = 0.1 (discover) + 1*h (find) + 1 (verify)          ≈ 2.1 credits
email + phone contact= 0.1 + 1*h + 1 + 10*ph                             ≈ 12.1 credits
```
Phone is ~**6× the whole email+verify cost** — it dominates any budget.

---

## 4. Worked example — Nordic Hydrogen project (49 leads / 77 contacts)

Assume hit-rates ≈ 0.8.

| Scenario | LimaData | Reoon | Feasible on current balances? |
|---|---|---|---|
| **Email + verify all 77** | 7.7 + 61.6 ≈ **69** | **77** | ✅ LimaData 592 ok; Reoon use instant pool |
| **+ phones for all 77** | +10×0.8×77 ≈ **+616** → ~**685** | +77 | ❌ LimaData 592 **short** — funds ~59 phones max |
| **Phones only, 59 leads** | 59×0.8×10 ≈ **472** | — | ⚠ leaves only ~120 LimaData credits |

**Takeaway:** email+verify is cheap and affordable now. **Phone enrichment needs a
LimaData top-up** before running across the project.

---

## 5. Calculator (reusable)

```js
const RATE = { discover:0.1, email:1, emailFromLinkedIn:3, phone:10, verify:1 };
function pipelineCost({contacts, emailHit=0.8, phoneHit=0.8, phones=false, viaLinkedIn=false}){
  const lima = contacts*RATE.discover
             + contacts*emailHit*(viaLinkedIn?RATE.emailFromLinkedIn:RATE.email)
             + (phones ? contacts*phoneHit*RATE.phone : 0);
  const reoon = contacts*emailHit*RATE.verify;            // verify each found email
  return { limaData:+lima.toFixed(1), reoon:+reoon.toFixed(1),
           total: +(lima+reoon).toFixed(1) };
}
// e.g. pipelineCost({contacts:77, phones:false})  -> {limaData:69.3, reoon:61.6}
//      pipelineCost({contacts:77, phones:true })  -> {limaData:684.9, reoon:61.6}
```

---

## 6. "Keep an eye" protocol

1. **Before any bulk run**, re-pull balances (all free/cheap):
   - LimaData `get_credits_balance`
   - ColdIQ `get_credit_balance` (returns `usd_per_credit` + `unlimited` state)
   - Reoon `GET /api/v1/check-account-balance/?key=` (two pools)
2. **Estimate first** with §5 against the target contact count; if estimate > balance,
   stop and flag before spending (mirrors the app's pre-call credit gate).
3. **Log actuals**: EXA/Firecrawl return `creditsUsed` per call — record it here monthly.
4. **Update this file's §1 snapshot** and change the date whenever refreshed.

---

## 7. Rules of thumb
- Verification (1cr) is trivial — always verify.
- Email find (1cr) is cheap — default path.
- LinkedIn-URL email find (3cr) — use only when domain is uncertain.
- **Phone (10cr) — opt-in per project, never auto-run**; it's the budget driver.
- ColdIQ sourcing is currently unfunded — prefer LimaData + EXA until topped up.
