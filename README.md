# TrustGate

An AI buyer-agent that decides whether money is allowed to move.

You type a purchase goal or name a merchant. TrustGate evaluates the seller, then either captures a Razorpay **test-mode** payment, authorizes-only (hold), or refuses with **no Razorpay call**.

Two independent gates must both allow the payment:

1. **Trust** — deterministic score from seller history, plus MCA/GST registry confidence when the merchant is not in the seed catalog
2. **User policy** — your spend caps and confirm-above threshold

Either gate can block or soften a payment. Neither alone is enough to approve. A high-trust seller can still be held if the amount crosses a rule you set (for example “confirm anything over ₹300”).

**Architecture boundary:** shopping finds the deal. TrustGate decides whether money can move. Catalog listings, GST Active status, and the LLM prompt do not authorize payment.

---

## How to use it

### 1. Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Minimum for a working chat agent:

| Variable | Needed for |
|----------|------------|
| `ANTHROPIC_API_KEY` | Buyer agent + explanations (`ANTHROPIC_WORKSPACE_ID` if the key is workspace-bound) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Real test payments (without these, payments **mock** and still log) |
| `DATA_GOV_IN_API_KEY` | Live MCA lookup — strongly recommended; the public sample key rate-limits |
| `APIFY_TOKEN` | IndiaMART catalog search (Star Wars t-shirt chip). Without it, search returns honest empty — no invented suppliers |
| `APIFY_INDIAMART_ACTOR_ID` | Optional; defaults to `sourabhbgp~indiamart-scraper` |
| `GST_VERIFY_URL` | Optional GST portal proxy (servers are often blocked; format/checksum still runs) |
| `TRUSTGATE_CONTROL_SECRET` | Optional locally. **Required on Vercel production/preview** or APIs return 503 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Kill switch across Vercel instances. Local `next dev` falls back to `data/kill-switch.json` |

### 2. What you see

The app is a chat-driven buyer, not a checkout page.

| Panel | What to do with it |
|-------|--------------------|
| **Purchase Request** | Type a goal (“cheapest banana bread”) or a named payee (“Pay Infosys Limited ₹250”). Use the chips under the box for canned demos. |
| **User Policy** | Edit the four spending rules. Changes save immediately and apply on the next request. **Reset** restores defaults. **Dev mode** reveals read-only trust-engine spend ceilings (not editable). |
| **Available Sellers** | Seed catalog names and prices. Scores stay hidden until the agent evaluates those sellers. Dev mode shows scores for debugging — turn it off for demos. |
| **Audit Log** | Full trail: trust, policy, `[live-lookup]`, `[search_catalog]`, `[product]`, `[price]`, `[gst]`, `[payment-gate]`, `[kill-switch]`. **Clear** wipes memory + `data/audit-log.json`. |
| **Stop all payments** | Header kill switch. Stops the agent and blocks Razorpay until you hit **Resume payments**. |

On a public Vercel URL you may see an unlock screen first. Enter `TRUSTGATE_CONTROL_SECRET` once (httpOnly cookie). Local `next dev` stays open unless you set that secret yourself.

### 3. Ask for something

Type naturally. The agent picks a path:

- **Seed seller** — “Get the cheapest banana bread you can find”
- **Named company not in the catalog** — “Pay Infosys Limited ₹250 for consulting”
- **Product the seed listings don’t cover** — “Buy a white Star Wars t-shirt” (needs `APIFY_TOKEN`; can take longer)

After each run, chat shows a comparison (price, score, action) and a short explanation. The audit log is the source of truth for *why*.

### Demo chips

| Button | What you should see |
|--------|---------------------|
| Cheapest banana bread | Cheap weak seller vs a safer bakery |
| Indian food, safely | Temptation listing vs Spice Garden |
| Phone case, best price | DealDash Express is cheapest (₹89) — recent dispute spike should refuse or hold |
| Coffee tasting ~₹450 | High-trust Blue Bottle **held** because ₹450 > ₹300 confirm threshold |
| Pay Infosys ₹250 | Live MCA path; high registry confidence can capture despite empty purchase history |
| Buy white Star Wars t-shirt | IndiaMART → product/price integrity → seller TrustGate → CAPTURE-first rank. HOLD is confirmation-only (not auto-paid) |

### 4. Change the rules, then re-run

Defaults (`src/lib/config/userPolicy.ts`):

| Rule | Default | Effect |
|------|---------|--------|
| Max per transaction | ₹5000 | Hard refuse above this |
| Max per seller | ₹10000 | Hard refuse above this (this request only) |
| Confirm above | ₹300 | Capture becomes **hold** even if trust said capture |
| Hold expiry | 3600s | Documented window; the demo does not build a full confirm UI |

Trust spend ceilings (₹200 trial, medium formula, high ₹1500 / ₹3000 / unlimited) are **engine constants**, not these fields. Inspect them under Dev mode.

**Punchline:** raise or lower Confirm above, re-run the coffee tasting chip, and watch the outcome change while the trust score stays the same.

### 5. Stop money instantly

**Stop all payments** in the header:

- Blocks `/api/purchase` agent runs
- Blocks `authorizeOrCapture` and Razorpay execution
- Writes `[kill-switch]` to the audit log and tells you in chat
- Status line shows **KILL SWITCH ON** until **Resume payments**

If every purchase says the kill switch is engaged, you left it on from a prior session.

---

## How it works

Flowcharts (Mermaid): [FLOW.md](./FLOW.md).

```
User message
  → Control plane (open locally; locked on Vercel without secret)
  → Kill switch on?  stop (₹0 Razorpay)
  → Buyer agent (Claude) chooses tools
       Seed seller?     checkTrust(sellerId, amount)
       Unknown company? lookupUnknownMerchant(name, amount, gstin?)
                        MCA (+ GST legal-name retry) → confidence
       Product search?  search_catalog
                        IndiaMART → product integrity → price (soft)
                        → seller MCA/GST/trust → user policy
                        → ShoppingAgent ranks CAPTURE-first
  → evaluateTrust (first-match rules) → applyUserPolicy (downgrade only)
  → authorizeOrCapture only if the server gate agrees
  → Explanation + audit log
```

The UI posts to `POST /api/purchase`. It does not score sellers or call Razorpay itself.

### Decision pipeline

1. **`scoreSeller`** — pure function, 0–100. Recent dispute periods weigh more than early ones. Empty history is *unknown* (not a perfect score). Tiers: high ≥ 75, medium ≥ 45, else low.
2. **Confidence** (live merchants only) — MCA Company Master Data. High / medium / low / adverse. Independent of risk.
3. **GST overlay** — identity bridge, not a substitute for MCA. Active GST on an MCA miss stays **low-band** (₹200 trial hold). Cancelled/suspended GST is adverse (refuse). Active GST cannot clear MCA dormant / elevated risk.
4. **`evaluateTrust`** — first matching rule wins, for example:
   - Adverse / elevated registry → **refuse**
   - Low confidence → **hold**, cap ₹200
   - Seed low-tier with no live confidence → **refuse** (spend limit 0)
   - Amount over trust spend limit → **hold** at the cap
   - High MCA + only missing history → often **capture** (registry floor)
   - Medium effective tier → **hold**
   - High effective tier → **capture**
5. **`applyUserPolicy`** — can only **downgrade** (capture → hold → refuse). Never turns a refusal into a payment.
6. **`assertPaymentAuthorized`** — server gate. The model must already have a stored decision for **this** `sellerId`, the tool `action` must match TrustGate (`capture` cannot override `hold`), and catalog `requires_confirmation` cannot auto-pay catalog sellers. Leftover catalog status does not block a seed or independent live-lookup payment in the same request.

When raw risk and effective score differ (common for live MCA merchants with no purchase history), the UI and audit log show both: `Raw 40 (low) → 75 (high)`.

### What each outcome does

| Outcome | Razorpay |
|---------|----------|
| **Capture** | Authorize and take the money |
| **Hold** (seed / live-lookup) | Authorize only |
| **Hold** (catalog `requires_confirmation`) | **No** payment in this request — ask the user first |
| **Refuse** | No Razorpay call |
| Kill switch / payment-gate reject | No Razorpay call |

If a Razorpay call times out or errors: retry once (~8s), then mark the case **flagged / unresolved** in the audit log instead of crashing or silently succeeding.

### Three entry paths

**Seed catalog** (`data/sellers.json`, eight merchants including adversarial **DealDash Express**). Agent calls `checkTrust`. No MCA. No GST.

**Live MCA** — company not in the seed file. Exact name + legal-form retries, then **fuzzy** normalized variants with a similarity gate (fail closed below 0.72). Weak hits are rejected. If MCA misses and a GSTIN is present, TrustGate validates GST and may retry MCA with the GST legal name.

**Catalog / ShoppingAgent** — product outside seed listings. IndiaMART via Apify. Proposals are untrusted:

1. **Product integrity** — listing must match the request (accessories for a primary good → refuse)
2. **Price integrity** — soft peer signal only; never a standalone refuse. Needs ≥5 priced matches in **this batch**; with today’s shortlist of 3 the check is usually skipped and audited
3. Seller MCA/GST/trust + user policy
4. Rank: cheapest **CAPTURE** → `authorized` (may auto-pay); else cheapest **HOLD** → `requires_confirmation`; else `no_viable`

A `[warning]` banner appears when shopping looks unreliable. TrustGate still decides; shopping does not.

---

## API

Locally these are open. On Vercel production/preview, unlock in the UI or send `x-trustgate-secret`.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth` | GET / POST | Control-plane mode (`open` / `password` / `locked`) and password unlock |
| `/api/sellers` | GET | Catalog (scores only with `?dev=1`); includes `paymentsKilled` |
| `/api/purchase` | POST | `{ message, userPolicy? }` — buyer agent |
| `/api/evaluate` | POST | `{ sellerId, amount, executePayment? }` — seed only, no agent |
| `/api/config` | GET / PUT / DELETE | Read / set / reset runtime policy |
| `/api/kill-switch` | GET / PUT | `{ killed: boolean }` |
| `/api/audit-log` | GET / DELETE | Audit entries; DELETE clears memory + file |

```bash
curl -X POST http://localhost:3000/api/purchase \
  -H 'Content-Type: application/json' \
  -d '{"message":"Pay Infosys Limited ₹250 for consulting"}'
```

Deterministic seed evaluate (bypasses the agent):

```bash
curl -X POST http://localhost:3000/api/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"sellerId":"seller-002","amount":450,"executePayment":true}'
```

Public deploy:

```bash
curl -X POST https://YOUR_DEPLOYMENT/api/purchase \
  -H 'Content-Type: application/json' \
  -H 'x-trustgate-secret: YOUR_SECRET' \
  -d '{"message":"Get me a coffee tasting, around ₹450"}'
```

---

## Scripts

- `npm run dev` — Next.js App Router
- `npm run test` — Vitest
- `npm run build` — production build

## Repo

- GitHub: https://github.com/Ishan-Malhotra/trustgate
- Flowcharts: [FLOW.md](./FLOW.md)
- Demo prep / file map: [PREP.md](./PREP.md)
- Build phase log: [logs.md](./logs.md)
