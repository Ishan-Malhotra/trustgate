# TrustGate

An AI buyer-agent that decides whether money can move, using two independent gates:

1. **Trust** — a deterministic score from the seller’s history (recent dispute trend weighted more than the average)
2. **User policy** — hard spend caps and a confirm-above threshold

Both must allow the payment. Trust also sets a **spend limit** (unlimited / cap / refuse), not just a yes/no. A high-trust seller can still be held if the amount crosses the user’s own rules.

Payments are real Razorpay **test-mode** calls: capture, authorize-only hold, or no API call on refuse.

**Architecture boundary:** Shopping / catalog finds the deal. TrustGate decides whether money can move. Catalog does not invent trust from GST or risk heuristics.

## Quick start

```bash
npm install
cp .env.example .env.local
# Required for the agent: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, ANTHROPIC_API_KEY
# Recommended: DATA_GOV_IN_API_KEY (MCA live lookup — public sample key rate-limits)
# Optional catalog: APIFY_TOKEN (+ optional APIFY_INDIAMART_ACTOR_ID)
# Optional GST proxy: GST_VERIFY_URL (portal is often blocked from servers)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Ask for a **goal** (e.g. "Get me the best banana bread you can find"), name a **real company** (e.g. "Pay Infosys Limited ₹250"), or use the **Star Wars t-shirt** chip for live IndiaMART → TrustGate discovery.

## How a purchase works

1. User sends a goal or names a merchant.
2. **Seed sellers:** agent calls `checkTrust` on catalog matches.
3. **Unknown merchants:** agent calls `lookupUnknownMerchant` → MCA registry → confidence + risk. If MCA misses and a GSTIN is present, TrustGate validates GST and may retry MCA with the legal name.
4. **Product outside seed catalog:** agent calls `search_catalog` → IndiaMART (Apify) → TrustGate per candidate → ShoppingAgent ranks **CAPTURE-first** by price (HOLD needs confirmation; never auto-purchased).
5. Compare trust, confidence, price, and policy; then `authorizeOrCapture` or `refuse`.
6. Audit log highlights `[live-lookup]`, `[search_catalog]`, and `[gst]`.

| Trust + policy outcome | Razorpay |
|------------------------|----------|
| High trust, within rules | Authorize **and** capture |
| Medium trust, or over `confirm_above_amount` (₹300) | Authorize only (hold) |
| Low trust, or over hard max | No Razorpay call |
| Low **confidence** (registry miss) | Trial hold capped at ₹200 — insufficient verifiable history |

### Demo paths

| Button | What it exercises |
|--------|-------------------|
| Cheapest banana bread | Cheap low-trust listing vs safer bakery |
| Indian food, safely | Cheap meal kit vs established restaurant |
| Phone case, best price | Gaming seller (`DealDash Express`) is cheapest at ₹89 |
| Coffee tasting ~₹450 | High-trust seller still **held** by user policy |
| Pay Infosys ₹250 | Live MCA lookup for a real company outside seed data |
| Buy white Star Wars t-shirt | IndiaMART catalog → TrustGate verify → cheapest CAPTURE, else cheapest HOLD recommendation (needs `APIFY_TOKEN`) |

Dev mode (seller panel, **off** by default) reloads scores for debugging. It is not the demo view.

### Live MCA lookup

Merchants not in `data/sellers.json` are looked up via India's Open Government Data **Company Master Data** (MCA registry). Risk (transaction signals) and confidence (registry verification) are separate:

- **High confidence** + clean risk → normal spend limits
- **Low confidence** (not found / thin registry) → ₹200 trial hold, not refusal
- **Adverse registry status** (struck-off / CIRP) → refuse regardless of confidence

Matching today is **exact company name + legal-form suffix retries** (e.g. `PRIVATE LIMITED`). Fuzzy name matching is not shipped yet.

Set `DATA_GOV_IN_API_KEY` in `.env.local` (register at [data.gov.in](https://data.gov.in)). Without it, a public sample key is used (rate-limited under load).

### Catalog discovery (IndiaMART)

`search_catalog` finds live suppliers and asks TrustGate; ShoppingAgent ranks by action then price:

```
search → normalize → ask TrustGate → rank CAPTURE-first by price → return
```

Statuses: `authorized` (auto-purchase CAPTURE) | `requires_confirmation` (cheapest HOLD, no auto-pay) | `no_viable` | `no_suppliers`.

Needs `APIFY_TOKEN`. Default actor: `sourabhbgp~indiamart-scraper`. Without a token, external search returns an honest empty result (no invented suppliers).

### GST verification

When a **GSTIN** is available (from catalog or tool input), TrustGate:

1. Validates format + checksum
2. Best-effort taxpayer lookup (optional `GST_VERIFY_URL` proxy — official portal often blocks servers)
3. On MCA trade-name miss + GST legal name → retries MCA with the legal name
4. Soft overlays Active / Cancelled onto confidence — **not** shopping-side trust

IndiaMART search rows often lack a GSTIN; the bridge only runs when one is present. Format-only checks still audit as `[gst]` when the portal is unavailable.

## User policy

`src/lib/config/userPolicy.ts` (visible constant, editable in principle):

- `max_spend_per_transaction`: ₹5000
- `max_spend_per_seller`: ₹10000
- `confirm_above_amount`: ₹300 (hold even if trust says capture)
- `hold_expiry_seconds`: 3600

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sellers` | GET | Public catalog (no scores). `?dev=1` includes scores/tiers |
| `/api/evaluate` | POST | `{ sellerId, amount, executePayment? }` — deterministic trust + policy |
| `/api/purchase` | POST | `{ message }` — goal-based buyer agent |
| `/api/audit-log` | GET | Timestamped trust, policy, payment, and refusal events |

```bash
curl -X POST http://localhost:3000/api/purchase \
  -H 'Content-Type: application/json' \
  -d '{"message":"Pay Infosys Limited ₹250 for consulting"}'
```

Deterministic evaluate (bypasses the agent; seed sellers only):

```bash
curl -X POST http://localhost:3000/api/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"sellerId":"seller-002","amount":500,"executePayment":true}'
```

## Scripts

- `npm run dev` — Next.js App Router
- `npm run test` — Vitest (trust, confidence, MCA, GST, catalog, policy, Razorpay retry)
- `npm run build` — production build

## Repo

- GitHub: https://github.com/Ishan-Malhotra/trustgate
- Phase log: [logs.md](./logs.md)
- Demo prep / codebase notes: [PREP.md](./PREP.md)
