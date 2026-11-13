# Vitalise — Front-End Design Specification

**Product:** the mail + outreach system inside `app.vitalise.io`
**Baseline:** Pulse (GrynH2 CRM inbox) — "Gmail, but extended"
**Status:** DESIGN ONLY (no code). Source of truth for Pulse behavior: `Downloads/cloude console/pulse`.
**Design goals:** *stable* (predictable layout, few reflows, offline-tolerant), *feature-rich* (all Pulse capabilities surfaced), *safe-by-default* (the recipient gate drives every send action).

---

## 0. Principles

1. **Gate-first.** Every send-capable surface shows the Reoon verdict *before* the send button is enabled. The UI never lets a user "just send" past an `invalid`/`spamtrap`; it only offers the sanctioned overrides (catch-all "Send anyway", 12-month-inbound pass) that Pulse already defines.
2. **Three-pane, fixed geometry.** The inbox uses a stable left/middle/right pane with draggable dividers persisted to `localStorage` (Pulse behavior). Panes never jump on data load — skeletons hold their size.
3. **Status is a first-class color language.** One palette for verification (`safe`/`catch_all`/`unknown`/`invalid`), one for delivery (`sent`/`delivered`/`bounced`), one for engagement (`opened`/`clicked`/`replied`). Never mix them on the same chip.
4. **Event-driven, not polling-heavy.** Reflects the hard rule "NEON and RENDER are our boundaries": no spinner that hammers an endpoint; live updates come from push (SSE today, Neon Realtime later). Idle screens must not wake the DB.
5. **Cost is visible.** Any action that spends credits (Reoon verify, Postmark bulk, Claude drafts) previews the cost and the remaining balance *before* confirm.
6. **Reversible by default.** Send-later, scheduled, and sequence steps are always shown as cancellable/reschedulable rows, never fire-and-forget.
7. **One voice.** Formal outreach tone (Pulse `outreachVoice.ts`); the composer nudges banned filler ("circling back", "just checking in").

## 1. Information Architecture & Navigation

Left rail (icon + label, collapses to icons like Pulse). Top-level sections:

| Section | Route | Purpose | Pulse/outreach basis |
|---|---|---|---|
| **Mail** | `/mail` | The Gmail-style inbox (default landing) | Pulse folders/threads |
| **Campaigns** | `/campaigns` | Bulk sends via Postmark; review mode | Pulse bulk scheduler |
| **Sequences** | `/sequences` | Multi-step follow-ups | follow-up-sequence-plan |
| **People** | `/people` | Contacts + Reoon verification + safe-to-contact | outreach-desk People tab |
| **Reach** | `/reach` | Per-recipient engagement analytics | per_recipient_tracking |
| **Signals** | `/signals` | Held/blocked/approving rows needing a decision | Pulse Signals card |
| **Deliverability** | `/deliverability` | DNS/auth, warmup, domain reputation | EMAIL_SYSTEM deliverability |
| **Settings** | `/settings` | Mailboxes, templates, AI, integrations, credits | Pulse settings gear |

Secondary/utility (top bar): **Compose** (global), **Search** (`/`), **Credits** pill, **Presence** status, **User menu**.

Routing rule: deep links must be shareable (`/mail?thread=…`, `/people?filter=safe-to-contact`) so a colleague can jump straight to a record — mirrors Pulse's CRM-match banners.

## 2. Design System (stability layer)

**Layout:** 12-column fluid grid, max content width 1600px; 8px base spacing scale (4/8/12/16/24/32). Two densities — *Comfortable* (reading) and *Compact* (lists/tables) — user-toggleable, persisted.

**Color tokens (CSS variables only, no hard-coded hex):**

- Neutrals: `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`.
- Brand: `--accent` (Vitalise), `--accent-hover`.
- **Verification language:** `--v-safe` (green), `--v-catchall` (amber), `--v-unknown` (slate), `--v-invalid` (red).
- **Delivery language:** `--d-sent` (blue-grey), `--d-delivered` (green), `--d-bounced` (red).
- **Engagement language:** `--e-opened` (teal), `--e-clicked` (indigo), `--e-replied` (green, bold).

Three separate palettes by design (Principle 3) so a green never ambiguously mean both "safe" and "replied".

**Typography:** one UI sans (system stack), one monospace for IDs/tokens/Message-IDs. Scale: 12/13/14 (body) /16/20/24. Line-height 1.5 body, 1.35 UI.

**Elevation & borders:** flat surfaces + 1px borders for structure; shadows reserved for overlays (compose pop, menus). No gradient/blur in core chrome (keeps repaints cheap → stability).

**Motion:** 120ms micro, 180ms pane/menu. Respect `prefers-reduced-motion`. No layout-shifting animations.

**Icons:** one set; unread/star/attachment/open/click/bounce/gate glyphs defined once.

## 3. App Shell

```
┌───────────────────────────────────────────────────────────────┐
│ ▣ Vitalise   [ Search ⌘K ]        ● Credits 128  ⛁ Presence ⏷ │  Topbar
├──────┬────────────────────────────────────────────────────────┤
│ RAIL │                    ACTIVE SECTION                       │
│ ✉ Mail│                                                       │
│ 📣 Camp│  (section mounts here; rail collapses to icons <1100px)│
│ 🔁 Seq │                                                       │
│ 👥 People│                                                     │
│ 📈 Reach│                                                      │
│ ⚑ Signals│                                                     │
│ 🛰 Deliverability│                                            │
│ ⚙ Settings│                                                    │
└──────┴────────────────────────────────────────────────────────┘
```

- **Rail:** fixed, 220px expanded / 56px collapsed; unread badge on Mail, held-count badge on Signals. Collapsed state persisted.
- **Topbar:** global search (opens command palette), credits pill (live Reoon/Postmark balance — Principle 5), presence menu, user menu.
- **Command bar (⌘K / `/`):** jump to thread/person/campaign, run actions (Compose, Verify, Approve held). Reuses Pulse shortcuts (`c` compose, `j/k` move, `e` archive, `s` star, `u` unread).
- **Toasts:** bottom-right; any "send", "scheduled", "held", "out of credits" event raises one with an inline Undo where reversible.

## 4. Core Screens
### 4.1 Mail / Inbox

The Pulse three-pane client, extended for outreach.

```
┌───────────┬───────────────────────────┬──────────────────────────────┐
│ FOLDERS   │ THREAD LIST               │ READER                       │
│ ▸Inbox 12 │ ☐▣ Qaisar · Re: Albania…  │  Re: Albania pipeline        │
│ ★Starred  │   09:14  "confirm dates…" │  ┌ CRM match: Lead · TSE ┐    │
│ ⤴Sent     │ ☐  Luc  · Press OOO       │  │ chips → Contact/Deal  │    │
│ ✎Drafts   │   08:50  (auto-reply)     │  └───────────────────────┘    │
│ ⚑Important│ ☑  Farhan · intro         │  …thread body, quoted trail…  │
│ ⚠Spam     │   ▣ opened 3× · clicked   │  engagement badges            │
│ ▤All Mail │                           │  [Reply][Reply all][Fwd][✦AI] │
│ ▤Archive  │  (virtualized list)       │  ☐ No follow-up               │
│ 🗑Trash   │                           │                              │
└───────────┴───────────────────────────┴──────────────────────────────┘
```

- **Folders** (exactly Pulse's set): Inbox, Starred, Sent, Drafts, Important, Spam, All Mail, Archive, Trash. Drafts auto-save every few seconds.
- **Thread rows:** checkbox, unread dot, star, sender, subject+snippet, timestamp, and an **engagement strip** (opened N×, last click, delivered/bounced icon) — Pulse's `PulseEngagementBadge`.
- **CRM match banner** (green) links to Contact/Lead/Deal/Account; if unmatched → inline quick-create Contact/Account/Task (Pulse behavior).
- **Reader actions:** Reply / Reply-all / Forward, **✦ AI** (1 strong draft + on-demand variants), Proofread, Star, Archive, Report spam, **"No follow-up"** tick.
- **Stability:** list virtualized (large mailboxes don't jank); panes resizable, sizes persisted; folder switch keeps scroll position.

### 4.2 Compose (normal + campaign)

A single composer with a **mode toggle** so the surface stays stable while functionality branches.

```
┌ Compose ────────────────────────── Normal ▾ | Campaign ────┐
│ From   Qaisar Ahmed <qaisar@vitalise.io>        (root mail) │
│ To     [ chip ] [ chip ]   Cc/Bcc ⌄                         │
│        gate: ✓ 2 · ⚠1 catch-all · ✕0        [Verify all]    │
│ Subject  ─────────────────────────────────────────────────  │
│ Body     ── [B I link] [✦ AI] [Check] ── live word-firewall  │
│ Attach ⧉   ☑ Track opens/clicks   ☑ Follow-up (3–5d)        │
│ Send ▾  [Send now | Send later… | Schedule in their hours]  │
└─────────────────────────────────────────────────────────────┘
```

- **Recipient field = the gate.** As addresses are typed, each chip shows its verification color. `✕` chips block Send; `⚠ catch-all` chips reveal the **"Send anyway"** affordance (single email only, incl. Cc/Bcc — Pulse rule); `unknown` chips show **Hold**, not Send. Chips that emailed us in the last 12 months pass with a note.
- **Live word-firewall** (Pulse compose warning): yellow note under the body naming the DreamHost-WAF word, the reason, a rewrite suggestion, click-to-jump. Warning only — never rewrites text.
- **✦ AI** drafts from thread + CRM + approved-reply library; **Check** runs proofread.
- **Send menu:** Send now · Send later (pick date) · **Schedule in recipient's local working hours** (09:00–10:00 their time, next working day if window passed; timezone from CRM country/phone/signature/domain — *never from name*; unknown → 09:30 CET default + flag).
- **Campaign mode** (see 4.3) swaps the recipient field for a segment picker and adds volume/warmup metering.

### 4.3 Campaigns (bulk via Postmark)

```
┌ Campaigns ─────────────────────────────────────────────────┐
│ [+ New campaign]                                           │
│ ▸ Q4 e-SAF outreach   Postmark·bulk.vitalise.io   1,240 →  │
│    status: 312 sent · 8 held · 2 bounced   [Review]        │
│ ▸ Wind investors      …                                    │
└─────────────────────────────────────────────────────────────┘
```

Campaign builder (wizard, one step per screen, stable height):
1. **Audience** — pick a People segment (e.g. `safe-to-contact`); shows count + gate breakdown upfront.
2. **From** — Postmark subdomain sender; reputation/warmup meter.
3. **Content** — template + merge fields; sample preview of ONE recipient.
4. **Review mode** — batch saved as draft → preview one sample → **Approve** → booked (Pulse bulk-review flow). Bulk stays **strict** (no catch-all override).
5. **Pacing** — daily cap, warmup ramp, per-mailbox gap; Postmark throughput.
- **Live campaign board:** sent/held/bounced/opened/clicked/replied counters + suppression auto-adds on bounce/complaint/unsubscribe.

### 4.4 People / Contacts

outreach-desk's core list, upgraded with the verification language.

```
┌ People ── [segment ▾ safe-to-contact] [search] [verify] ───┐
│ Name · Company · Email · Verify · Delivered · Replied · ⌚  │
│ ▣ Qaisar · TSE · luc.derai@tse.energy · ✓safe · ✓ · ·      │
│ ⚠ …        catch_all (hold from bulk, ok single)           │
│ ✕ …        invalid → suppressed                            │
│ ☐ select → [Add to campaign] [Verify (n)] [Export]         │
└─────────────────────────────────────────────────────────────┘
```

- **Column = `safeToSend`** derived from Reoon status + policy; the **`safe-to-contact` filter/segment** is the primary view (ties to to-do item).
- **Verify (n)** = batch Reoon with **cost preview** (n credits, balance) before confirm — Principle 5.
- Row drill-in: contact profile, every thread, every campaign touch, sequence state, suppression reason, `verifiedAt` + **stale >60–90d** flag.
- **Stability:** virtualized table, sticky header, column visibility persisted; optimistic edits with CAS-revision refresh guard (the app already uses optimistic-revision).

### 4.5 Reach & Analytics

Pulse "Reach": one row per recipient per email.

- Table: recipient · email · sent · delivered · opened N× · last click · **location (city/region/country, GeoIP)** · replied. Gmail/Apple proxy opens show **"Hidden"**.
- Filters: campaign, segment, subject variant, date. **Reply-rate per variant/batch/model** (P5 metric).
- Timeline drawer per recipient: each open/click/download with location line.
- Charts render in a canvas-style panel (data is the deliverable), not raw tables.

### 4.6 Sequences / Follow-ups

- Visual step ladder: **3–5d → 15–20d → 30–40d → 90d → 6-month intent check.** Each step shows status (booked/sent/skipped/cancelled) and next-fire time in recipient's hours.
- **Stop rules surfaced:** reply (person or their company domain), bounce, unsubscribe/"not interested", user writes, manual "Stop follow-ups".
- Per-step copy: AI-written vs fixed-approved toggle (open decision); banned-filler check applied.
- Case handling (Pulse): out-of-office → follow up on return day in their zone; "contact my colleague" → forward with original in Cc.

### 4.7 Suppression & Unsubscribe

- **Suppression list** (read-only audit): every hard bounce, complaint, manual unsub, and Reoon `invalid/disposable/spamtrap`, with reason + timestamp. Enforced at send time (gate + campaign audience exclude suppressed).
- **Unsubscribe landing** (public, minimal, fast): one click, no login; sets suppression + `List-Unsubscribe` honored.
- Compliance block: physical postal address + sender identity shown in campaign footer preview (GDPR/CAN-SPAM).

### 4.8 Deliverability & DNS

- Per-domain status cards: **root `vitalise.io`** (MX/SPF/DKIM/DMARC pass/fail, relay probe) and **bulk subdomain** (Postmark auth). Reuses Pulse `/deliverability` + relay-probe banner.
- **Warmup meter** per mailbox/subdomain: current daily cap, ramp curve, reputation signals.
- "Send a test to mail-tester" action + `spf/dkim/dmarc=pass` readout.

### 4.9 Settings

Tabs: **Mailboxes** (root DreamHost + Postmark servers) · **Templates** · **AI integrations** (key, model, monthly cap, spend shown) · **Tracking & deliverability** toggles · **Integrations/API keys** (`pulse_send`-style external key) · **Credits & spend** (Reoon, Postmark, Claude — live balances + caps) · **Team & permissions** (`emails.read`/`send`/`manage`).

## 5. Component Inventory

| Component | Used in | Notes |
|---|---|---|
| `GateChip` | Compose, People, Campaigns | renders verification color + tooltip verdict |
| `EngagementStrip` | Thread list, Reach | opened/clicked/delivered/replied badges |
| `CrmMatchBanner` | Reader, People drill-in | green chips or quick-create |
| `WordFirewallNote` | Compose | yellow WAF-word warning, click-to-jump |
| `ScheduleInTheirHours` | Compose, Campaigns | tz resolution chain + 09:00–10:00 slot |
| `CostPreviewDialog` | Verify, bulk send, AI | credits/spend + remaining balance |
| `HeldRowCard` | Signals | Re-check / Approve / Reschedule / Cancel |
| `SequenceLadder` | Sequences | 5-step visual + stop rules |
| `StatusMeter` | Campaigns, Deliverability | sent/held/bounced; warmup ramp |
| `ResizablePanes` | Mail | persisted divider sizes |
| `CommandPalette` | Global | nav + actions, Pulse shortcuts |

## 6. States & Edge Cases

- **Empty / loading / error** on every list with fixed-height skeletons (no reflow).
- **Held / blocked rows** always remain visible with their reason (Pulse: blocked scheduled rows stay visible), never silently dropped.
- **Out of credits (Reoon/Postmark/Claude):** send is **held**, not sent unchecked; banner + cost dialog disabled with a "top up" link. Never fail-open.
- **"Server didn't answer" (unknown):** auto re-check once next morning before final block (Pulse P2 #7).
- **Organization-policy bounce (e.g. DOE profanity filter):** not treated as recipient invalid; surfaces a "plain delivery" hint (parked Pulse feature).
- **CAS revision conflict** (optimistic-revision app): "workspace changed, refresh" guard on every mutation.
- **Offline / Render asleep:** reads cached, writes queue and replay; no infinite spinners.

## 7. Interaction Patterns

- **Gate feedback is inline and immediate**, never a post-submit error. Send button state = f(gate).
- **Catch-all "Send anyway"** appears only when *every* blocked address is catch-all, single emails only; bulk never gets it.
- **Approve → local-hours booking** is one click (Pulse one-click Next morning/Approve/Re-check).
- **Undo** on send-later/schedule/campaign-book within the toast window.
- **Destructive/cost actions** (bulk send, batch verify) require a confirm dialog that restates count + cost + domain.

## 8. Responsiveness & Performance

- **Breakpoints:** ≥1280 three-pane; 900–1280 two-pane (reader overlays list); <900 single-pane with back-stack (rail → drawer).
- **Virtualization** on thread list, People table, Reach table.
- **No polling storms:** live data via SSE (today) / Neon Realtime (later) — honoring the Neon/Render boundary rule; idle screens issue zero DB-touching requests.
- **Bundle:** route-level code-split per section; composer and tables are the only heavy chunks.
- **Stability targets:** 0 layout shift on data load; interactions < 100ms perceived; optimistic UI with rollback.

## 9. Build Phasing (v1 / v2 / v3)

- **v1 — send + track + suppress (safe core):** App shell, Mail inbox, Compose with gate + word-firewall, People with `safe-to-contact` filter + batch verify (cost preview), root-domain relay send, basic open/click tracking, suppression + unsubscribe, Deliverability status. *(Matches the recommended v1 scope.)*
- **v2 — campaigns + sequences + analytics:** Postmark Campaigns (wizard + review mode), Sequences ladder + follow-ups + OOO/colleague cases, Reach analytics with GeoIP + reply-rate by variant, Signals held-row workflow, scheduling-in-their-hours.
- **v3 — extended/realtime:** AI draft quality (answer library, 1 strong draft, calendar slots), Research & advise, per-recipient copies, plain-delivery-per-domain, Neon Realtime push, presence.

## 10. Open Decisions

1. **Reuse Pulse `external/send` vs port Pulse UI** — decides whether Mail/Compose are new build or shared.
2. **Bulk subdomain name** (`bulk.vitalise.io` vs separate lookalike) — affects Deliverability screen layout.
3. **v1 include inbound replies/IMAP?** — if yes, Mail needs the sync + Sent-append UI from day one.
4. **AI model default** (Haiku vs Sonnet from votes) and monthly cap shown in Settings → AI.
5. **Follow-up copy:** AI-written vs fixed-approved texts (Pulse open question).
6. **Design fidelity next step:** do you want a **visual mockup/wireframe** (HTML prototype) of Mail + Compose + Campaigns to review before the build plan?
