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
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Ask for a **goal**, not a seller name, e.g. “Get me the best banana bread you can find”.

### Environment

| Variable | Purpose |
|----------|---------|
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Test-mode keys. Missing keys → mock orders |
| `RAZORPAY_TEST_PAYMENT_ID` | Optional authorized `pay_` id for capture experiments |
| `ANTHROPIC_API_KEY` | Buyer agent + explanation layer (Claude Sonnet 4.5) |
| `ANTHROPIC_WORKSPACE_ID` | Only if the key is identity-linked |

## How a purchase works

1. User sends a goal (item + optional budget). Demo buttons never name a seller.
2. The agent filters the public catalog (name, category, listings) and calls `checkTrust` on **each** relevant seller.
3. It compares price vs trust vs policy, then `authorizeOrCapture` or `refuse`.
4. Chat shows the comparison (scores appear **after** evaluation). The side panel stays a public catalog unless Dev mode is on.

| Trust + policy outcome | Razorpay |
|------------------------|----------|
| High trust, within rules | Authorize **and** capture |
| Medium trust, or over `confirm_above_amount` (₹300) | Authorize only (hold) |
| Low trust, or over hard max | No Razorpay call |

### Demo paths

| Button | What it exercises |
|--------|-------------------|
| Cheapest banana bread | Cheap low-trust listing vs safer bakery |
| Indian food, safely | Cheap meal kit vs established restaurant |
| Phone case, best price | Gaming seller (`DealDash Express`) is cheapest at ₹89 |
| Coffee tasting ~₹450 | High-trust seller still **held** by user policy |

Dev mode (seller panel, **off** by default) reloads scores for debugging. It is not the demo view.

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
  -d '{"message":"Buy a phone case, best price"}'
```

Deterministic evaluate (bypasses the agent):

```bash
curl -X POST http://localhost:3000/api/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"sellerId":"seller-002","amount":500,"executePayment":true}'
```

## Scripts

- `npm run dev` — Next.js App Router
- `npm run test` — Vitest (`scoreSeller`, policy, Razorpay retry, env parse)
- `npm run build` — production build

## Repo

- GitHub: https://github.com/Ishan-Malhotra/trustgate
- Phase log: [logs.md](./logs.md)
