# Jev Scoring Logic

## Purpose

Prioritise Nordic green-hydrogen production projects for partnership sourcing in the 10–20 MW target range across Norway, Sweden, Finland, Denmark and Iceland.

This is the standing JEV procedure for Outreach Desk. It is based on Jev_Scoring_Logic.docx and the Nordic H2 leads workbook dated 2026-11-10.

## Evidence inputs

For each project, provide only the supplied evidence for:

- Country and site
- Scale (MW)
- Development stage
- Permits and approvals
- PPA or offtake
- Bankability or funding
- Seeking-partner signal
- Named developer or owner
- Source URL and source date

Missing evidence must remain missing. Do not infer a binding agreement, secured permit, FID, bankability, or an open investment mandate from a consortium, grant, technical supplier, or general project activity.

## Outputs

Jev returns three values:

1. Jev Seeking-Investment (Noul): probability from 0 to 1 that the project is actively seeking external capital or a partner now.
2. Jev ICP Fit Score: score from 0 to 4 for target fit.
3. Jev Tier: Strong, Partial, Watch, or Funded.

The score is not the outreach state. Outreach state remains a separate operational field.

## ICP fit score

FitScore = C1 + C2 + C3 + C4, rounded to two decimals.

Each criterion is scored from 0 to 1, with fractional credit allowed.

### C1 — Scale and geography

- 1.0: 10–20 MW in Norway, Sweden, Finland, Denmark or Iceland.
- 0.5: adjacent scale or Nordic-adjacent geography.
- 0.1: materially outside the target range or geography.

### C2 — Development stage

- 1.0: feasibility through pre-FID, where a partner or investor is genuinely needed.
- 0.5: very early concept or pilot, or late post-FID stage.
- 0.1: operating or fully de-risked.

### C3 — Permits and offtake readiness

Average the permit/approval signal and the PPA/offtake signal.

- Full credit: approvals are secured and/or credible offtake/PPA evidence exists.
- Partial credit: an application, conditional grant, LOI, MoU, or negotiation is documented.
- Zero: neither permits nor offtake evidence is documented.

Binding agreements and secured approvals must be distinguished from non-binding or pending evidence.

### C4 — Bankability and capital need

- 1.0: clear funding gap with an investable structure, such as secured grants, a credible financing plan, or named institutional support.
- 0.5: funding gap with weak structure, or strong structure with no clear funding gap.
- 0.1: not investable or already fully financed.

## Seeking-investment score

Score the seeking signal together with stage and bankability:

- 0.8–1.0: explicitly raising external investors, jointly evaluating options, or needing financing to reach FID.
- 0.4–0.7: partner-open or capital-relevant, but not actively marketing a round.
- 0.0–0.3: already financed, FID taken, operating, or clearly not seeking a new partner.

## Tier rules

Evaluate in this order:

    if SeekInv <= 0.5 and Stage in {FID-taken, operating, fully-financed}:
        Tier = "Funded"
    elif FitScore >= 2.5 and SeekInv >= 0.6:
        Tier = "Strong"
    elif 2.0 <= FitScore < 2.5 and SeekInv >= 0.6:
        Tier = "Partial"
    else:
        Tier = "Watch"

Funded means not a new-partner deal. It can remain in the database for monitoring, co-investment or secondary opportunities, but must not be presented as an active mandate.

## TypeSafe/Jev request procedure

1. Select exactly one project record.
2. Build a focused state object containing that project’s targeting and individual evidence.
3. Keep questions, criteria, model name and thresholds in one auditable module.
4. Ask Jev for the typed score and the Noul. Do not ask it to decide outreach state.
5. Validate the response: score must be numeric and between 0 and 4; Noul must be numeric and between 0 and 1; model name must be present.
6. Insert the valid result for that one record and commit the database transaction.
7. Only after the commit succeeds, select the next record.
8. Keep the original source evidence and the JEV result together.
9. If the API fails or returns an invalid answer, record an error and leave the previous score unchanged. Never convert an API failure into a low score.

### Mandatory one-record guard rail

- Never send an array, batch, list, or multi-record payload to Jev.
- The scoring endpoint accepts only workspace, project and one lead ID.
- A second scoring request is rejected while any record is in flight.
- Each valid response is committed before another record can be scored.
- Company/contact consolidation must never cause project-level scores to be copied between records.

## Reliability controls

- Do not score a company from unrelated portfolio evidence when the target project is not identified.
- Do not treat a grant as full bankability by itself.
- Do not treat an LOI, MoU or heads of terms as a binding offtake.
- Do not treat a technical partner or equipment supplier as an equity investor.
- Do not change lifecycle, outreach marks, assignments, do-not-contact status or campaign state as a side effect of scoring.
- Re-score when the targeting or project evidence changes.
- Preserve the previous result until the replacement result passes validation.
- Keep workbook/static scores distinguishable from fresh TypeSafe scores by model and timestamp.

## Standing record fields

    jevFit.score
    jevFit.model
    jevFit.basis
    jevFit.scoredAt
    segment
    lifecycle
    source
    description
    notes

Segment and lifecycle remain separate from JEV. JEV is a fit and investment-intent assessment, not an outreach activity status.
