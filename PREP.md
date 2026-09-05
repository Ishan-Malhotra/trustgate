# TrustGate — Demo Prep Notes

Living reference for how the product works today. Update this after every completed build step so demo prep stays accurate.

---

## Current stage (2026-09-05)

**Branch:** `feat/trustgate-proposal-integrity` (ahead of `main` with integrity + kill switch; `main` has Phase 10 catalog + GST + CAPTURE-first HOLD fix).

TrustGate is past the seed-catalog demo. It now:

1. **Finds deals** via IndiaMART (`search_catalog` / ShoppingAgent) — shopping is untrusted
2. **Independently evaluates proposals** — product integrity → price integrity → seller MCA/GST/trust → user policy
3. **Ranks CAPTURE-first** — HOLD is recommendation only (`requires_confirmation`), never auto-purchase
4. **Enforces that on the server** — `authorizeOrCapture` cannot capture a HOLD seller, cannot pay a catalog HOLD candidate, and cannot reuse another seller’s decision. Seed / live-lookup payments are not locked by leftover catalog status
5. **Warns** when shopping hallucinates or keeps proposing bad deals (`[warning]` banner)
6. **Kill switch** — one header button stops all autonomous payments and agent purchase runs instantly
7. **Control plane** — local demo stays open; Vercel production/preview is locked unless `TRUSTGATE_CONTROL_SECRET` is set
8. **Fuzzy MCA** — normalized name variants + similarity gate (fail closed below 0.72)
9. **GST overlay** — Active GST is an MCA bridge, not a substitute. MCA miss + GST Active → trial hold, never capture

**Still next:** magic trade-name → unrelated legal-name without GSTIN / stronger evidence (not inventing matches).

| Layer | Status |
|-------|--------|
| Seed catalog + trust/policy + Razorpay | Done |
| Live MCA lookup (Infosys) | Done — needs `DATA_GOV_IN_API_KEY` |
| IndiaMART catalog discovery | Done — needs `APIFY_TOKEN` |
| GST format + legal-name MCA bridge | Done — portal often blocked; optional `GST_VERIFY_URL` |
| CAPTURE-first shopping rank | Done |
| Proposal product/price integrity + reliability warnings | Done (this branch) |
| Kill switch | Done (this branch) |
| Server payment gate (`assertPaymentAuthorized`) | Done (this branch) |
| ControlGate / `TRUSTGATE_CONTROL_SECRET` | Done (this branch) — local open; public deploy fail-closed |
| Fuzzy MCA matching | Done — variants + similarity ≥ 0.72; weak hits rejected |

---

## What this product is

TrustGate is an AI buyer-agent. You tell it what you want to buy (or who to pay). It decides whether money is allowed to move.

Two separate gates must both allow the payment:

1. **Trust** — how safe does this seller look, based on history / registry checks?
2. **User policy** — does this amount break rules the buyer set for themselves?

Either gate can block or soften a payment. Neither alone is enough to approve.

The decision is not cosmetic. It drives a real **Razorpay test-mode** call:
- **Capture** — authorize and take the money (normal buy)
- **Hold** — authorize only, money on hold
- **Refuse** — no Razorpay call at all

For catalog deals there is an extra TrustGate harness **before** seller trust: product must match the user request, and price must not be an extreme peer anomaly. ShoppingAgent cannot authorize money.

---

## Stack at a glance

| Piece | Where |
|-------|--------|
| Next.js App Router + TypeScript | `src/app/`, `src/` |
| UI (chat, sellers, policy, audit, kill switch, ControlGate) | `src/components/` |
| Deterministic trust math | `src/lib/trust/` |
| User policy gate | `src/lib/policy/` |
| Buyer agent + tools | `src/lib/agent/` |
| Catalog providers (`search_catalog`) | `src/lib/catalog/` |
| Proposal integrity + shopping reliability | `src/lib/trustgate/` |
| GST validation / verify / confidence overlay | `src/lib/gst/` |
| Kill switch | `src/lib/config/killSwitch.ts`, `killSwitchStore.ts` |
| Payment tool gate | `src/lib/agent/assertPaymentAuthorized.ts` |
| Control-plane auth | `src/lib/config/controlAuth.ts`, `src/proxy.ts`, `/api/auth` |
| Untrusted catalog text | `src/lib/security/sanitizeUntrustedText.ts` |
| Razorpay test payments | `src/lib/razorpay/` |
| MCA live company lookup | `src/lib/registry/` |
| Seed sellers | `data/sellers.json` |
| Audit log file | `data/audit-log.json` |
| Default policy constants | `src/lib/config/userPolicy.ts` |
| Runtime (editable) policy | `src/lib/config/runtimePolicy.ts` |

Run locally: `npm install` → copy `.env.example` to `.env.local` → fill keys → `npm run dev` → open http://localhost:3000.

Needed env:
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — real test payments (without these, payments mock)
- `ANTHROPIC_API_KEY` — buyer agent + explanations (`ANTHROPIC_WORKSPACE_ID` if your key is workspace-bound)
- `DATA_GOV_IN_API_KEY` — strongly recommended; MCA lookup falls back to a public sample key (rate-limits under demo load)
- `APIFY_TOKEN` / `APIFY_INDIAMART_ACTOR_ID` — optional; without token, external catalog search returns no suppliers (honest empty, not invented). Actor ID defaults to `sourabhbgp~indiamart-scraper`
- `GST_VERIFY_URL` — optional proxy; official GST portal often blocks servers (format/checksum still runs)
- `TRUSTGATE_CONTROL_SECRET` — optional locally (demo stays open). **Required on Vercel production/preview** or APIs return 503. Unlock once in the UI, or send `x-trustgate-secret`
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — kill switch shared flag. **Required on Vercel** so Stop all payments applies to every function instance. Local `next dev` falls back to `data/kill-switch.json`

---

## The big idea in one flow

```
User message
    → Kill switch on?  stop agent + tell user (₹0 Razorpay)
    → Buyer agent (Claude) picks tools
        → Seed seller?  checkTrust(sellerId, amount)
        → Unknown company by name?  lookupUnknownMerchant(name, amount)
            → MCA (+ optional GST legal-name bridge) → confidence
            → scoreSeller → evaluateTrust → applyUserPolicy
        → Product outside seed catalog?  search_catalog({ query, budget? })
            → IndiaMART search + normalize (untrusted proposals)
            → TrustGate per candidate:
                 product integrity → price integrity
                 → seller MCA/GST/trust → user policy
                 → CAPTURE / HOLD / REFUSE
            → shopping reliability warning if proposals look bad
            → ShoppingAgent ranks CAPTURE-first
                 (authorized | requires_confirmation | no_viable)
        → authorizeOrCapture (server gate, not just the prompt)
             action must match stored TrustGate decision for that sellerId
             catalog requires_confirmation / no_viable → refuse payment in this request
    → Human-readable explanation
    → Audit log + chat UI update
```

**Boundary that matters:** Shopping / catalog finds the deal. TrustGate decides whether money can move. Catalog does not invent trust or approve from GST alone.

Everything important happens on the server through API routes. The chat UI just posts a message and renders the result.

---

## Seed sellers (the demo catalog)

File: `data/sellers.json` — eight static merchants. No real onboarding.

Each seller has:
- Identity: `id`, `name`, `category`
- Risk signals: `account_age_days`, `kyc_verified`, `dispute_rate_history`, `return_rate`, `price_volatility`
- Shopping hints: `known_for`, `listings` (item + INR price)

Loader: `src/lib/sellers.ts` — `getAllSellers()`, `getSellerById()`.

### Who’s who (useful for demos)

| ID | Name | Why they matter |
|----|------|-----------------|
| seller-001 | Spice Garden | Solid Indian restaurant — “buy safely” path |
| seller-002 | Blue Bottle Coffee | High trust; coffee tasting at ₹450 hits the policy hold |
| seller-003 | TechFix Mobile Repairs | Medium / riskier electronics repair |
| seller-004 | Bargain Bazaar | Cheap + weak trust — banana bread / meal kit temptation |
| seller-005 | Fresh Farms Co-op | Safer grocery / banana bread alternative |
| seller-006 | QuickShip Gadgets | Mid electronics, phone cases |
| seller-007 | Sunrise Bakery | Safer banana bread at a higher price |
| seller-gaming | DealDash Express | **Adversarial** — dispute history starts clean then spikes `[0.01, 0.015, 0.02, 0.18, 0.42]`. Cheapest phone case at ₹89. Scoring should catch the recent spike. |

Default catalog API (`GET /api/sellers`) **hides scores**. Dev mode (`?dev=1`) shows them for debugging only — not the demo view.

---

## Trust scoring (no LLM)

File: `src/lib/trust/scoreSeller.ts`

Pure, deterministic. Same seller → same score every time.

Rough recipe:
- **Dispute history** — recent periods weigh more than early ones. Empty history is treated as *unknown* (not “perfectly clean”).
- **Bonuses** — KYC verified, account age
- **Penalties** — return rate, price volatility, and a “no transaction history” penalty when history is empty
- **High MCA confidence** can waive the no-history penalty when the only gap is missing purchase history (`trustSignals.ts`)

Output score 0–100 → tier:
- **high** ≥ 75
- **medium** ≥ 45
- **low** below 45

Spend limits (`getSpendLimit.ts` + `trustSpendLimits.ts`) — **engine constants**, not user settings:
- Seed / no confidence: low tier → refuse (`0`); medium → capped formula; high → ₹1500 / ₹3000 / unlimited at 85+
- With live confidence: low confidence → ₹200 trial cap; medium confidence caps tighter; high confidence + history-only gap uses normal high-tier limits
- Visible read-only under **Dev mode** on the User Policy panel (inspection, not editing)

---

## Risk vs confidence vs effective score

This is the part demo audiences often need explained carefully.

**Risk (raw signals)** — disputes, returns, volatility, missing history. Comes from `scoreSeller`.

**Confidence (registry verification)** — how sure are we this merchant even exists / looks legitimate in India’s MCA Company Master Data? Comes from `computeConfidence()` in `src/lib/trust/confidence.ts`. Independent from risk.

**Effective score / tier** — what we actually decide with, after registry floors and overrides in `evaluateTrust()`.

When they differ (common for live MCA merchants with no purchase history), the UI and audit log show both:
`Raw 40 (low) → 75 (high)`.

### Confidence bands (MCA)

| Band | Typical meaning | Spend behavior |
|------|-----------------|----------------|
| high (~85) | Active MCA, registered >2 years, meaningful paid-up capital | Can approve capture even with empty dispute history |
| medium (~50) | Found but thin (young / low capital) | Capped spend |
| low (~15) | Not found / thin / dormant | ₹200 trial **hold**, not a hard refuse |
| adverse | Struck off / liquidation / etc. | Refuse regardless |

---

## evaluateTrust — turning score into an action

File: `src/lib/trust/evaluateTrust.ts`

Takes seller + amount (+ optional confidence). Returns a `TrustDecision`:
- `action`: capture | hold | refuse
- `spendLimit`, `effectiveAmount`
- `trustReason`
- `riskScore` / `riskTier` and `effectiveScore` / `effectiveTier`

Notable rules:
- Adverse / elevated registry risk → refuse
- Low confidence → hold, amount capped at ₹200 (“insufficient verifiable history”)
- Amount over trust spend limit → hold at the cap
- High confidence + only missing history → registry trust floor (effective score floored to 75 or 55) and often **capture**
- Low effective tier without that high-registry floor → **hold**, never the default capture (GST or a young MCA hit is not enough to auto-pay)
- Medium effective tier → hold
- High effective tier → capture

Then **user policy** runs as a second gate.

---

## User policy (second gate)

Defaults in `src/lib/config/userPolicy.ts` — these are the **only** spend rules the demo UI edits:

| Rule | Default | Effect |
|------|---------|--------|
| `max_spend_per_transaction` | ₹5000 | Hard refuse above this |
| `max_spend_per_seller` | ₹10000 | Hard refuse above this |
| `confirm_above_amount` | ₹300 | Capture becomes **hold** even if trust said capture |
| `hold_expiry_seconds` | 3600 | Documented hold window (demo doesn’t build a full confirm UI) |

Trust spend ceilings (`TRUST_SPEND_LIMITS` in `src/lib/trust/trustSpendLimits.ts`) stay engine constants. **Dev mode** on the User Policy panel reveals them read-only (formula + caps) for transparency — same idea as score reveal: inspect, don’t casually tamper.

`applyUserPolicy()` (`src/lib/policy/applyUserPolicy.ts`) can only **downgrade** (capture → hold → refuse). It never upgrades a trust refusal into a payment.

Runtime edits: UI policy panel → `PUT /api/config` → `runtimePolicy.ts` in-memory. Each purchase also sends the current policy in the body so the next request uses what you see on screen. Reset = `DELETE /api/config`.

**Demo punchline:** Blue Bottle coffee tasting ~₹450 is high trust, but policy holds it because ₹450 > ₹300 confirm threshold.

---

## Buyer agent

Files: `src/lib/agent/buyerAgent.ts`, `src/lib/agent/tools.ts`, `src/lib/agent/assertPaymentAuthorized.ts`

Claude (via Vercel AI SDK + Anthropic) with a system prompt that includes the public catalog (names, listings — not scores).

### Tools

| Tool | When | What it does |
|------|------|--------------|
| `checkTrust` | Seed catalog sellers | `evaluateTrust` + `applyUserPolicy`, logs trust + policy |
| `lookupUnknownMerchant` | Real company not in seed data | MCA lookup → synthetic seller → confidence → same gates + reasoning chain |
| `search_catalog` | Product goal **not** covered by seed listings | IndiaMART → product/price integrity → seller TrustGate → ShoppingAgent CAPTURE-first (`authorized` / `requires_confirmation` / `no_viable`) |
| `authorizeOrCapture` | After a check | Server-enforced: exact seller decision, action must match TrustGate (`capture` cannot override `hold`); catalog `requires_confirmation` cannot pay catalog candidates (seed / live-lookup still can) |
| `refuse` | Agent chooses not to pay | Logs refusal; no Razorpay |

Rules baked into the prompt **and enforced on the server**:
- Always check trust / lookup before paying — `authorizeOrCapture` requires `decisionsBySellerId[sellerId]` (no `lastDecision` fallback)
- Payment `action` must equal the stored TrustGate action (`capture` on a HOLD seller is rejected)
- Catalog `requires_confirmation` / `no_viable` / `no_suppliers` cannot pay **catalog-search** sellers; leftover status does not block seed / independent live-lookup payments
- Never invent a seed id for an unknown merchant
- Don’t refuse just because a merchant is “new” — use confidence
- Follow `recommendedAction` from the tools
- High MCA confidence can approve capture even when raw risk looks medium due to missing history
- Product outside seed catalog → `search_catalog` (do not force a fake seed match); honest `no_suppliers` / `no_viable` is correct
- Catalog statuses: `authorized` → may pay capture; `requires_confirmation` → do **not** auto-pay HOLD; surface shoppingReliability warnings when present

Entry: `POST /api/purchase` with `{ message, userPolicy? }`. Kill switch short-circuits this with a user-facing stop message.

Deterministic bypass (seed only): `POST /api/evaluate` with `{ sellerId, amount, executePayment? }` — same gates, no agent (payment still blocked if kill switch is on).

---

## TrustGate proposal integrity (shopping harness)

ShoppingAgent proposals are **untrusted**. Before seller/policy ranking, TrustGate runs:

1. **Product integrity** — does the listing match the original user request? (fail closed; accessories for primary goods → REFUSE). Example: “Buy me a PS5” + “PS5 Controller Cover” → REFUSE.
2. **Price integrity** — soft peer-relative signal only (never a standalone REFUSE). Requires ≥5 priced product-matching candidates in the **same search batch**; with today’s `MAX_CATALOG_CANDIDATES = 3` the check is skipped and audited. Extreme/moderate anomalies annotate the decision; seller MCA/policy still decide capture/hold/refuse.

### Price anomaly — how it works (spec)

| Question | Answer |
|----------|--------|
| Where is peer median from? | **This search batch only** — other product-matching catalog listings after product integrity. No stored market index. |
| Typical sample size? | IndiaMART shortlist is capped at **3** (`MAX_CATALOG_CANDIDATES`), so a median is usually **not** computed. |
| When can it fire? | Only if the priced product-matching **pool ≥ 5**. Below that → skip + `[price] Skipped anomaly check — insufficient sample size` in audit. |
| Thresholds | Heuristic ratios vs peer median (not calibrated MSRP): **extreme** if quoted/median `< 0.15` or `> 6`; **moderate** if `< 0.4` or `> 2.5`. |
| Decision impact | Soft signal / confidence-style annotation only. **Never refuse on price alone.** Clean MCA + cheap outlier → still follow seller TrustGate action. |

Files: `src/lib/trustgate/priceIntegrity.ts`, `evaluateCatalogProposals.ts`.

3. Existing seller MCA/GST/trust + user policy
4. **Shopping reliability warning** — caution / unreliable when the shopping source hallucinates or keeps proposing bad deals (demo `[warning]` / TrustGate intervening banner)

Files: `src/lib/trustgate/*` (`productIntegrity`, `priceIntegrity`, `shoppingReliability`, `evaluateCatalogProposals`). ShoppingAgent only ranks TrustGate-permitted actions.

### Kill switch (demo control)

One header button (**Stop all payments**) engages a **shared** kill switch:

- Stops buyer-agent purchase runs immediately (`/api/purchase`)
- Blocks `authorizeOrCapture` and `executeApprovedPayment` (₹0 to Razorpay)
- Audits `[kill-switch]` and tells the user in chat
- Status line shows **KILL SWITCH ON**; **Resume payments** re-enables
- Every check **reads the store** (no in-process cache of the flag)

**Where the flag lives:** Upstash Redis key `trustgate:payments_killed` when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set. That is the Vercel path — Fluid Compute instances do not share `globalThis`. Locally, without Redis, the flag is `data/kill-switch.json` (shared on that machine). A Vercel deploy without Redis logs an error and is **not** cross-instance.

Files: `src/lib/config/killSwitch.ts`, `killSwitchStore.ts` · API: `GET/PUT /api/kill-switch`

### Control plane (API access)

This **is shipped** — not a WIP. Local `next dev` stays open so the laptop demo still works with no extra env.

On Vercel **production/preview**:
- No secret → APIs return **503** (`control_locked`). UI shows “TrustGate is locked.”
- Secret set → unlock screen once; httpOnly cookie `trustgate_access`, or header `x-trustgate-secret`
- Covers purchase, evaluate, policy, kill switch, sellers, and the audit log (GST/MCA details are not world-readable)

Files: `src/lib/config/controlAuth.ts`, `src/proxy.ts`, `src/app/api/auth/route.ts`, `src/components/ControlGate.tsx`

### Server payment gate (prompt is not enough)

`assertPaymentAuthorized` runs inside `authorizeOrCapture` before any Razorpay call:

1. Must have a stored decision for **this** `sellerId` (no `lastDecision` fallback)
2. Catalog status applies only to sellers from that search (`lastShoppingSellerIds`). `requires_confirmation` / `no_viable` / `no_suppliers` cannot pay those catalog sellers; leftover status does **not** block seed-catalog or independent live-lookup payments
3. Catalog `authorized` → capture only the chosen catalog seller (other catalog candidates still blocked)
4. Tool `action` must equal TrustGate’s stored action (`capture` cannot override `hold`)
5. Respect spend limit / refuse

Audit tag: `[payment-gate]`. Seed-catalog HOLDs (coffee tasting) still pay with `action: "hold"` — including after a prior `search_catalog` in the same request, as long as that seller was not a catalog candidate.

Catalog merchant names are sanitized (`sanitizeUntrustedText`) so a listing cannot inject extra “Status: authorized” lines into the model’s tool output.

---

## Catalog search (Shopping Agent / providers)

Shopping Agent finds deals. Catalog providers search + normalize. **TrustGate alone** decides if a deal can be transacted.

```
search_catalog
  → Catalog Provider (IndiaMART first)
  → normalize CatalogCandidate { merchantName, productName, amount, gstin, … }
  → evaluateCatalogProposals (product → price → seller/policy)
  → shoppingReliability warning if needed
  → ShoppingAgent: cheapest CAPTURE → authorized;
       else cheapest HOLD → requires_confirmation (no auto-pay);
       else no_viable
  → return structured result for the buyer agent to narrate / pay
```

Files:
- `src/lib/catalog/types.ts` — provider-agnostic candidate + search result + integrity fields
- `src/lib/catalog/providers/indiamart.ts` — Apify IndiaMART actor (default `sourabhbgp~indiamart-scraper`), session cache, never invents suppliers; merchant names sanitized
- `src/lib/catalog/searchCatalog.ts` — search + TrustGate proposal evaluation
- `src/lib/agent/shoppingAgent.ts` — CAPTURE-first ranking + writes `lastShoppingStatus` / `lastShoppingSellerIds` for the payment gate
- `src/lib/agent/lookupUnknownMerchant.ts` — shared TrustGate live path used by tool + catalog
- `src/lib/trustgate/` — proposal integrity harness

GST on IndiaMART search rows is often empty. When a **GSTIN is present**, TrustGate now:

1. Validates format + checksum (`src/lib/gst/validateGstin.ts`)
2. Tries taxpayer lookup (`verifyGstin` — portal or optional `GST_VERIFY_URL` proxy)
3. On MCA trade-name miss + GST legal name → **retries MCA** with the legal name
4. Overlays GST onto confidence (`applyGstConfidenceOverlay`) — **not** shopping-side trust and **not** an MCA substitute. Active GST on an MCA miss stays low-band (₹200 trial hold). Cancelled/suspended GST is adverse (refuse). Active GST does not clear MCA dormant / elevated risk. If MCA already landed medium, GST may corroborate the level (still not capture by itself).

Portal lookups are frequently blocked from servers; without `GST_VERIFY_URL` you still get honest format-only `[gst]` audit lines.

**Demo button:** “Buy white Star Wars t-shirt” — external catalog path (needs `APIFY_TOKEN`; can take longer; loading label explains it). GST bridge only fires when listings include a GSTIN. Fuzzy MCA may help punctuation / short legal-form gaps; unrelated trade names still need GSTIN.

### Pre-demo: IndiaMART trade name → MCA match (re-tested)

Matching today uses **exact filters plus fuzzy query variants**, then a **similarity gate** (fail closed):

1. Exact name + legal suffixes (as before)
2. Normalized variants — strip punctuation (`A.S.International` → `A S INTERNATIONAL` / `AS INTERNATIONAL`), `&` → `AND`, compact initials
3. Token / short-name + suffix tries (e.g. distinctive first token when long enough)
4. Only accept an API hit if `scoreNameSimilarity(query, companyName) ≥ 0.72`

Files: `src/lib/registry/fuzzyCompanyName.ts` wired into `mcaLookup.ts`. Audit notes fuzzy score when used.

Completely different trade vs legal names still miss without GSTIN — that is expected.

Live re-test (2026-09-03) with `sourabhbgp~indiamart-scraper` + MCA API:

| Source | Trade / query name | MCA hit? | How | Expected TrustGate path |
|--------|-------------------|----------|-----|-------------------------|
| Control | Infosys Limited | Yes | Exact | High confidence → capture (if within policy) |
| Star Wars chip | Berryblues Export (OPC) Private Limited | Yes | Exact | Active registry → stronger confidence than trade names |
| Star Wars chip | ORN Clothing Private Limited | Yes | Exact | Active registry |
| Star Wars chip | S Creation | No | — | Low confidence (~15%) → trial hold |
| Star Wars chip | 4S Print Solutions | No | — | Low confidence → trial hold |
| Star Wars chip | A.S.International | No | — | Low confidence → trial hold |
| Water-bottle run | MAHAVIR INDUSTRIES LIMITED | Yes | Exact | **Under CIRP** → refuse (adverse) |
| Water-bottle run | Anax Impex / Saijee Impex | No | — | Low confidence → trial hold |
| Category fallback | Gopesh Uniforms | Yes | Suffix → `… PRIVATE LIMITED` | Active registry |

**Day-of risks (not nice-to-haves):**
1. **`DATA_GOV_IN_API_KEY` unset** — public sample key **429**s under demo load. Put a real data.gov.in key in before stage.
2. Star Wars chip often returns **~2/5 legal-form names that exact-match** and **~3/5 trade names that miss**. Expect a **mix of registry-verified + low-confidence holds**.
3. Without GSTIN on the row, trade names still miss MCA — honest low-confidence hold is correct.
4. Kill switch left ON from a prior demo will block every purchase until Resume.
5. **Public Vercel URL without `TRUSTGATE_CONTROL_SECRET`** — app looks locked (503). Set the env var before a staged demo, then unlock once in the UI.

---

## Live MCA lookup

Files: `src/lib/registry/mcaLookup.ts`, `sellerFromMca.ts`

Hits data.gov.in **Company Master Data**. Exact name / CIN filters, **fuzzy name variants + similarity scoring**, company-suffix retries, session caches (verified + name→CIN). API errors do not poison the “no match” cache. Weak fuzzy hits are rejected (fail closed).

`sellerFromMca` builds a temporary seller (`live:<CIN>` or `live:unknown:...`) with empty dispute history. Age/KYC come from the registry row when present.

Live lookups write audit entries tagged `[live-lookup]` (cyan highlight in the UI) plus a step-by-step reasoning chain (`buildReasoningChain.ts`). Catalog verification also logs `[search_catalog]` per candidate.

**Demo button:** “Pay Infosys ₹250” — company outside the seed catalog. Requires MCA API not rate-limited.

---

## Razorpay path

Isolated helpers:
- `createOrder` — create order for amount
- `authorizeOnly` — authorize against the order
- `capturePayment` — capture an authorized payment

Orchestrator: `executeApprovedPayment()` — order → authorize → capture if action is capture and payment id looks real (`pay_...`).

Failure path (`retry.ts`): ~8s timeout, **retry once**, then mark **flagged / unresolved** in the audit log instead of crashing or silently succeeding.

No keys → mock mode (still logs a payment event so the UI demo works).

---

## Explanation layer

`generateExplanation()` — one Claude call after the decision, turns scores + policy into 1–3 plain sentences. If Anthropic isn’t configured or fails, a deterministic fallback string is used. Comparison-aware when multiple sellers were checked.

---

## Audit log

`src/lib/audit/logger.ts` — append-only in memory + `data/audit-log.json`.

Types you’ll see: `agent`, `trust_check`, `policy_check`, `payment`, `refusal`, `reasoning`, `error`, `flagged`.

UI: `AuditLogPanel` — live feed; reasoning / `[live-lookup]` / `[search_catalog]` / `[product]` / `[price]` / `[warning]` / `[kill-switch]` / `[gst]` highlighted. Payment-tool blocks show up as refusals tagged `[payment-gate]`.

API: `GET /api/audit-log`, `DELETE /api/audit-log` (Clear button in the panel).

---

## Frontend layout

`TrustGateApp` wires everything:

| Panel | Role |
|-------|------|
| Unlock (public deploy only) | ControlGate password screen when `TRUSTGATE_CONTROL_SECRET` is set |
| Header | Tagline + status (`Agent connected • Payment gate active • ● Protected`); kill switch button |
| Chat | Goals + quick demos; comparison after evaluation; TrustGate intervening banner when shopping is unreliable |
| User Policy | Editable spending rules; **Dev mode** reveals read-only trust engine spend constants |
| Audit Log | Full trail + **Clear** — fills the right column under policy |

Quick demos (chat buttons):
1. Cheapest banana bread — cheap weak seller vs safer bakery
2. Indian food, safely — temptation vs Spice Garden
3. Phone case, best price — DealDash gaming seller is cheapest
4. Coffee tasting ~₹450 — high trust + policy hold
5. Pay Infosys ₹250 — live MCA path
6. Buy white Star Wars t-shirt — external catalog → integrity + TrustGate → CAPTURE-first rank

---

## API cheat sheet

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth` | GET / POST | Control-plane mode (`open` / `password` / `locked`) and password unlock |
| `/api/sellers` | GET | Catalog (scores only with `?dev=1`); includes `paymentsKilled` |
| `/api/purchase` | POST | Agent purchase `{ message, userPolicy? }` (blocked if kill switch on) |
| `/api/evaluate` | POST | Deterministic seed evaluate |
| `/api/config` | GET / PUT / DELETE | Read / set / reset runtime policy |
| `/api/kill-switch` | GET / PUT | Read / set `{ killed: boolean }` |
| `/api/audit-log` | GET / DELETE | Audit entries; DELETE clears in-memory + file |

Locally these APIs are open. On Vercel production/preview they need the control cookie or `x-trustgate-secret`.

---

## What “good” looks like in a demo (checklist)

1. **Normal buy** — high-trust seed seller within policy → capture (Razorpay test dashboard if keys set).
2. **Trust says no / cap** — medium/low or gaming seller refused or held with a clear reason.
3. **Policy overrides trust** — coffee ~₹450 held despite high trust (confirm threshold). Confirm threshold is a **user policy confirmation** rule, not an “auto-approval threshold.”
4. **Gaming seller** — DealDash cheapest phone case; recent dispute spike shows up in score + log.
5. **Live lookup** — Infosys (or another real MCA company); confidence vs risk visible; `[live-lookup]` in audit.
6. **External catalog** — Star Wars t-shirt chip; `[search_catalog]` → product/price integrity → seller TrustGate → ShoppingAgent CAPTURE-first (HOLD = `requires_confirmation`, never auto-purchased).
7. **Integrity story** (optional narration) — wrong SKU / extreme cheap price would REFUSE even if seller looks fine; `[product]` / `[price]` / `[warning]` in the log.
8. **Kill switch** — hit **Stop all payments**, try a purchase chip, agent stopped + clear user message; **Resume** and buy again.
9. **Editable policy** — change confirm threshold, re-run, outcome changes immediately.
10. **End-to-end log** — trust, integrity, and policy reasoning readable for every decision.

---

## Intentionally out of scope

- Multi-agent scoring pipelines
- Real seller onboarding / user accounts (ControlGate is a demo password for the public URL, not end-user auth)
- Generic checkout UI (chat *is* the product)
- Full confirmation workflow for holds (timer concept only; catalog HOLD asks in chat, does not auto-pay)
- Making the ShoppingAgent “smarter” — TrustGate harness assumes it can be wrong
- Magic trade-name → unrelated legal-name resolution without GSTIN / registry evidence

---

## Where to look when something breaks

| Symptom | First places |
|---------|----------------|
| Agent won’t run | `ANTHROPIC_API_KEY` / workspace id; `/api/purchase` error body; kill switch ON? |
| “Kill switch engaged” on every request | Header **Resume payments**; `GET /api/kill-switch` |
| Payments always “mock” | Razorpay keys in `.env.local`; restart `npm run dev` |
| MCA always miss / rate limit | `DATA_GOV_IN_API_KEY`; check `[live-lookup]` failure reason in audit |
| Catalog empty | `APIFY_TOKEN`; `[search_catalog]` audit lines |
| HOLD auto-purchased | Should not happen for catalog — check status `requires_confirmation` and `[payment-gate]` in the log |
| “TrustGate is locked” / 503 on APIs | Public deploy missing `TRUSTGATE_CONTROL_SECRET`; set it and reload |
| Unlock screen on localhost | You set `TRUSTGATE_CONTROL_SECRET` in `.env.local` — expected; enter it or remove the var |
| Policy edits ignored | Confirm `PUT /api/config` + purchase body includes `userPolicy` |
| Scores visible before decision | Dev mode on, or looking at `?dev=1` — turn Dev off for demos |
| Wrong Infosys outcome | Confidence band + raw vs effective in audit; registry floor logic in `evaluateTrust` |

---

## File map (short)

```
data/sellers.json          seed merchants
data/audit-log.json        persisted audit
src/lib/trust/             score, spend limit, evaluate, confidence, reasoning
src/lib/policy/            applyUserPolicy
src/lib/agent/             buyerAgent, tools, shoppingAgent, lookupUnknownMerchant, assertPaymentAuthorized
src/lib/catalog/           types, searchCatalog, IndiaMART provider
src/lib/trustgate/         product/price integrity, reliability, evaluateCatalogProposals
src/lib/gst/               validate / verify / confidence overlay
src/lib/security/          sanitizeUntrustedText (catalog names)
src/lib/razorpay/          order / auth / capture / retry / execute (+ kill check)
src/lib/registry/          MCA lookup + sellerFromMca
src/lib/explanation/       human-readable decision text
src/lib/audit/             logger
src/lib/config/            env, userPolicy, runtimePolicy, killSwitch, controlAuth, anthropic
src/proxy.ts               API control-plane gate (skips /api/auth)
src/components/            TrustGateApp, Chat, Policy, Sellers, Audit, TrustGateWarning, ControlGate
src/app/api/               purchase, evaluate, sellers, config, kill-switch, audit-log, auth
logs.md                    build phase log
PREP.md                    this file — demo prep reference
```

---

## Changelog of this prep doc

| When | Note |
|------|------|
| 2026-09-02 | Initial prep doc covering seed catalog, trust/policy gates, agent tools, MCA live lookup, Razorpay, UI, demo checklist |
| 2026-09-05 | Current stage: IndiaMART catalog, GST bridge, CAPTURE-first HOLD semantics, proposal integrity + shopping warnings, kill switch; fixed stale “GST not built” / flow / API / demo checklist |
| 2026-09-05 | Fuzzy MCA: normalized name variants + similarity gate in `fuzzyCompanyName.ts` / `mcaLookup.ts` |
| 2026-09-05 | Price anomaly: batch-only peers, min pool 5, soft signal (never standalone refuse); explanation multi-reason ordered list |
| 2026-09-05 | Payment + control-plane hardening: server `assertPaymentAuthorized`, catalog HOLD cannot auto-pay, no lastDecision fallback, catalog name sanitization, ControlGate / `TRUSTGATE_CONTROL_SECRET` (local open, Vercel fail-closed) |
| 2026-09-05 | Catalog payment gate scoped to `lastShoppingSellerIds` — leftover `authorized` status no longer blocks seed / live-lookup sellers |
| 2026-09-05 | GST overlay cannot invent capture: Active GST on MCA miss stays low-band; low effective tier without high-registry floor holds |
| 2026-09-05 | Kill switch is shared state (Upstash Redis / local file), not `globalThis` — every payment path re-reads the store |
| 2026-09-05 | README rewritten as the product usage guide (UI, env, demo chips, decision pipeline). This file stays the deep demo/codebase notes |
| 2026-09-05 | [FLOW.md](./FLOW.md) — Mermaid flowcharts for the full request, three entry paths, evaluateTrust, policy, payment gate |
