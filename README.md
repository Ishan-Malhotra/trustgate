# TrustGate

AI buyer-agent that decides whether to pay a seller based on **trust scoring** and **user spending policy**, controlling real Razorpay test-mode payments.

## Quick start

```bash
npm install
cp .env.example .env.local   # add Razorpay test keys + OpenAI key
npm run dev
```

## API (steps 1–7)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sellers` | GET | List seeded sellers |
| `/api/evaluate` | POST | `{ sellerId, amount, executePayment? }` — deterministic trust + policy |
| `/api/purchase` | POST | `{ message }` — AI buyer agent |
| `/api/audit-log` | GET | Full audit trail |

### Example evaluate

```bash
curl -X POST http://localhost:3000/api/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"sellerId":"seller-001","amount":250}'
```

Hold a high-trust seller over policy threshold:

```bash
curl -X POST http://localhost:3000/api/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"sellerId":"seller-002","amount":500}'
```

## Scripts

- `npm run dev` — Next.js dev server
- `npm run test` — Vitest unit tests
- `npm run build` — Production build

## User policy

Configured in `src/lib/config/userPolicy.ts` (visible constant, editable in principle).

## Build progress

See [logs.md](./logs.md) for phase-by-phase status.
