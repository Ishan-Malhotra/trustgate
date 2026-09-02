# TrustGate — Demo Prep Notes

Living reference for how the product works today. Update this after every completed build step so demo prep stays accurate.

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

---

## Stack at a glance

| Piece | Where |
|-------|--------|
| Next.js App Router + TypeScript | `src/app/`, `src/` |
| UI (chat, sellers, policy, audit) | `src/components/` |
| Deterministic trust math | `src/lib/trust/` |
| User policy gate | `src/lib/policy/` |
| Buyer agent + tools | `src/lib/agent/` |
| Catalog providers (`search_catalog`) | `src/lib/catalog/` |
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
- `DATA_GOV_IN_API_KEY` — optional; MCA lookup falls back to a public sample key (rate-limited)
- `APIFY_TOKEN` / `APIFY_INDIAMART_ACTOR_ID` — optional; without token, external catalog search returns no suppliers (honest empty, not invented). Actor ID defaults to `sourabhbgp~indiamart-scraper` (`makework36~indiamart-suppliers-scraper` still works if set)

---

## The big idea in one flow

```
User message
    → Buyer agent (Claude) picks tools
        → Seed seller?  checkTrust(sellerId, amount)
        → Unknown company by name?  lookupUnknownMerchant(name, amount)
            → MCA registry → confidence
            → scoreSeller → evaluateTrust → applyUserPolicy
        → Product outside seed catalog?  search_catalog({ query, budget? })
            → Catalog provider (IndiaMART) search + normalize
            → ask TrustGate (same lookup path) per candidate
            → rank TrustGate-approved by price
        → authorizeOrCapture  OR  refuse
    → Human-readable explanation
    → Audit log + chat UI update
```

**Boundary that matters:** Shopping / catalog finds the deal. TrustGate decides whether money can move. Catalog does not invent trust, inspect GST for approval, or calculate risk.

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

Spend limits (`getSpendLimit.ts`):
- Seed / no confidence: low tier → refuse (`0`); medium → capped; high → ₹1500 / ₹3000 / unlimited at 85+
- With live confidence: low confidence → ₹200 trial cap; medium confidence caps tighter; high confidence + history-only gap uses normal high-tier limits

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
- Medium effective tier → hold
- High effective tier → capture

Then **user policy** runs as a second gate.

---

## User policy (second gate)

Defaults in `src/lib/config/userPolicy.ts`:

| Rule | Default | Effect |
|------|---------|--------|
| `max_spend_per_transaction` | ₹5000 | Hard refuse above this |
| `max_spend_per_seller` | ₹10000 | Hard refuse above this |
| `confirm_above_amount` | ₹300 | Capture becomes **hold** even if trust said capture |
| `hold_expiry_seconds` | 3600 | Documented hold window (demo doesn’t build a full confirm UI) |

`applyUserPolicy()` (`src/lib/policy/applyUserPolicy.ts`) can only **downgrade** (capture → hold → refuse). It never upgrades a trust refusal into a payment.

Runtime edits: UI policy panel → `PUT /api/config` → `runtimePolicy.ts` in-memory. Each purchase also sends the current policy in the body so the next request uses what you see on screen. Reset = `DELETE /api/config`.

**Demo punchline:** Blue Bottle coffee tasting ~₹450 is high trust, but policy holds it because ₹450 > ₹300 confirm threshold.

---

## Buyer agent

Files: `src/lib/agent/buyerAgent.ts`, `src/lib/agent/tools.ts`

Claude (via Vercel AI SDK + Anthropic) with a system prompt that includes the public catalog (names, listings — not scores).

### Tools

| Tool | When | What it does |
|------|------|--------------|
| `checkTrust` | Seed catalog sellers | `evaluateTrust` + `applyUserPolicy`, logs trust + policy |
| `lookupUnknownMerchant` | Real company not in seed data | MCA lookup → synthetic seller → confidence → same gates + reasoning chain |
| `search_catalog` | Product goal **not** covered by seed listings | Catalog provider search → normalize → ask TrustGate per candidate → rank approved by price |
| `authorizeOrCapture` | After a check | Runs Razorpay capture or hold using the **stored** decision for that seller |
| `refuse` | Agent chooses not to pay | Logs refusal; no Razorpay |

Rules baked into the prompt:
- Always check trust / lookup before paying
- Never invent a seed id for an unknown merchant
- Don’t refuse just because a merchant is “new” — use confidence
- Follow `recommendedAction` from the tools
- High MCA confidence can approve capture even when raw risk looks medium due to missing history
- Product outside seed catalog → `search_catalog` (do not force a fake seed match); honest `no_suppliers` / `no_viable` is correct

Entry: `POST /api/purchase` with `{ message, userPolicy? }`.

Deterministic bypass (seed only): `POST /api/evaluate` with `{ sellerId, amount, executePayment? }` — same gates, no agent.

---

## Catalog search (Shopping Agent / providers)

Shopping Agent finds deals. Catalog providers search + normalize. **TrustGate alone** decides if a deal can be transacted.

```
search_catalog
  → Catalog Provider (IndiaMART first; ONDC/Shopify later)
  → normalize CatalogCandidate { merchantName, amount, source, … }
  → ask TrustGate (runLookupUnknownMerchant) for each shortlisted candidate
  → rank TrustGate-approved (lowest price); refuse-filtered out
  → return structured result for the buyer agent to narrate / pay
```

Files:
- `src/lib/catalog/types.ts` — provider-agnostic candidate + search result
- `src/lib/catalog/providers/indiamart.ts` — Apify IndiaMART actor (default `sourabhbgp~indiamart-scraper`), session cache, never invents suppliers
- `src/lib/catalog/searchCatalog.ts` — `search_catalog()` orchestration
- `src/lib/agent/shoppingAgent.ts` — thin wrapper (no GST/risk logic)
- `src/lib/agent/lookupUnknownMerchant.ts` — shared TrustGate live path used by tool + catalog

GST on IndiaMART rows is optional metadata only — never used to approve a seller.

**Demo button:** “Buy white Star Wars t-shirt” — external catalog path (needs `APIFY_TOKEN`; can take longer; loading label explains it).

---

## Live MCA lookup

Files: `src/lib/registry/mcaLookup.ts`, `sellerFromMca.ts`

Hits data.gov.in **Company Master Data**. Exact name / CIN filters, company-suffix retries, session caches (verified + name→CIN). API errors do not poison the “no match” cache.

`sellerFromMca` builds a temporary seller (`live:<CIN>` or `live:unknown:...`) with empty dispute history. Age/KYC come from the registry row when present.

Live lookups write audit entries tagged `[live-lookup]` (cyan highlight in the UI) plus a step-by-step reasoning chain (`buildReasoningChain.ts`). Catalog verification also logs `[search_catalog]` per candidate.

**Demo button:** “Pay Infosys ₹250” — company outside the seed catalog.

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

UI: `AuditLogPanel` — live feed; reasoning / `[live-lookup]` / `[search_catalog]` highlighted.

API: `GET /api/audit-log`.

---

## Frontend layout

`TrustGateApp` wires everything:

| Panel | Role |
|-------|------|
| Chat | Goals + quick demos; shows comparison after evaluation (scores only after the agent checked them) |
| User Policy | Editable numbers; apply on next purchase |
| Available Sellers | Public catalog; scores reveal only for sellers checked in that request (or Dev mode) |
| Audit Log | Full trail |

Quick demos (chat buttons):
1. Cheapest banana bread — cheap weak seller vs safer bakery
2. Indian food, safely — temptation vs Spice Garden
3. Phone case, best price — DealDash gaming seller is cheapest
4. Coffee tasting ~₹450 — high trust + policy hold
5. Pay Infosys ₹250 — live MCA path
6. Buy white Star Wars t-shirt — external catalog → TrustGate verify → rank approved

---

## API cheat sheet

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sellers` | GET | Catalog (scores only with `?dev=1`) |
| `/api/purchase` | POST | Agent purchase `{ message, userPolicy? }` |
| `/api/evaluate` | POST | Deterministic seed evaluate |
| `/api/config` | GET / PUT / DELETE | Read / set / reset runtime policy |
| `/api/audit-log` | GET | Audit entries |

---

## What “good” looks like in a demo (checklist)

1. **Normal buy** — high-trust seed seller within policy → capture (Razorpay test dashboard if keys set).
2. **Trust says no / cap** — medium/low or gaming seller refused or held with a clear reason.
3. **Policy overrides trust** — coffee ~₹450 held despite high trust (confirm threshold).
4. **Gaming seller** — DealDash cheapest phone case; recent dispute spike shows up in score + log.
5. **Live lookup** — Infosys (or another real MCA company); confidence vs risk visible; `[live-lookup]` in audit.
6. **External catalog** — Star Wars t-shirt chip; `[search_catalog]` candidates → TrustGate decisions → cheapest approved (or honest no_viable).
7. **Editable policy** — change confirm threshold, re-run, outcome changes immediately.
8. **End-to-end log** — trust reasoning and policy reasoning both readable for every decision.

---

## Intentionally out of scope

- Multi-agent scoring pipelines
- Real seller onboarding / auth
- Generic checkout UI (chat *is* the product)
- Full confirmation workflow for holds (timer concept only)
- GST verification / fuzzy MCA matching (noted as future, not built)

---

## Where to look when something breaks

| Symptom | First places |
|---------|----------------|
| Agent won’t run | `ANTHROPIC_API_KEY` / workspace id; `/api/purchase` error body |
| Payments always “mock” | Razorpay keys in `.env.local`; restart `npm run dev` |
| MCA always miss / rate limit | `DATA_GOV_IN_API_KEY`; check `[live-lookup]` failure reason in audit |
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
src/lib/agent/             buyerAgent + tools
src/lib/razorpay/          order / auth / capture / retry / execute
src/lib/registry/          MCA lookup + sellerFromMca
src/lib/explanation/       human-readable decision text
src/lib/audit/             logger
src/lib/config/            env, userPolicy, runtimePolicy, anthropic
src/components/            TrustGateApp, Chat, Policy, Sellers, Audit
src/app/api/               purchase, evaluate, sellers, config, audit-log
logs.md                    build phase log
PREP.md                    this file — demo prep reference
```

---

## Changelog of this prep doc

| When | Note |
|------|------|
| 2026-09-02 | Initial prep doc covering seed catalog, trust/policy gates, agent tools, MCA live lookup, Razorpay, UI, demo checklist |
