# TrustGate

An AI buyer-agent that decides whether money can move, using two independent gates:

1. **Trust** — a deterministic score from the seller’s history (recent dispute trend weighted more than the average)
2. **User policy** — hard spend caps and a confirm-above threshold

Both must allow the payment. Trust also sets a **spend limit** (unlimited / cap / refuse), not just a yes/no. A high-trust seller can still be held if the amount crosses the user’s own rules.

Payments are real Razorpay **test-mode** calls: capture, authorize-only hold, or no API call on refuse.

## Quick start

```bash
npm install
cp .env.example .env.local
# fill RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, ANTHROPIC_API_KEY
# optional: DATA_GOV_IN_API_KEY for MCA live lookup
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Ask for a **goal** (e.g. "Get me the best banana bread you can find") or name a **real company outside the seed catalog** (e.g. "Pay Infosys Limited ₹250") for live MCA lookup.

## How a purchase works

1. User sends a goal or names a merchant outside the catalog.
2. Seed sellers: agent calls `checkTrust` on each relevant catalog match.
3. Unknown merchants: agent calls `lookupUnknownMerchant` → live MCA registry → confidence + risk.
4. Compare trust, confidence, price, and policy; then `authorizeOrCapture` or `refuse`.
5. Audit log entries tagged `[live-lookup]` are highlighted in the UI.

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

Dev mode (seller panel, **off** by default) reloads scores for debugging. It is not the demo view.

### Live MCA lookup

Merchants not in `data/sellers.json` are looked up via India's Open Government Data **Company Master Data** (MCA registry). Risk (transaction signals) and confidence (registry verification) are separate:

- **High confidence** + clean risk → normal spend limits
- **Low confidence** (not found / thin registry) → ₹200 trial hold, not refusal
- **Adverse registry status** (struck-off) → refuse regardless of confidence

Optional `DATA_GOV_IN_API_KEY` in `.env.local` (register at [data.gov.in](https://data.gov.in)). Without it, a public sample key is used (rate-limited).

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
- `npm run test` — Vitest (scoreSeller, confidence, mcaLookup, policy, Razorpay retry, env parse)
- `npm run build` — production build

## Repo

- GitHub: https://github.com/Ishan-Malhotra/trustgate
- Phase log: [logs.md](./logs.md)
- Demo prep / codebase notes: [PREP.md](./PREP.md)
