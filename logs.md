# TrustGate Build Log

## Phase 1 — Seller seed data (Step 1)
- **Done:** `data/sellers.json` with 8 sellers (7 legitimate + 1 adversarial `seller-gaming`)
- Gaming seller has dispute history that starts clean then spikes: `[0.01, 0.015, 0.02, 0.18, 0.42]`
- Seller loader at `src/lib/sellers.ts`

## Phase 2 — Trust scoring (Steps 2–3)
- **Done:** `scoreSeller()` — deterministic, weights recent dispute periods heavier
- **Done:** `getSpendLimit(tier, score)` — low=refuse, medium=capped, high=unlimited at 85+
- **Done:** `evaluateTrust()` combines scoring + tier action mapping
- **Tests:** `src/lib/trust/__tests__/scoreSeller.test.ts`

## Phase 3 — Razorpay wiring (Step 4)
- **Done:** `createOrder`, `authorizeOnly`, `capturePayment` as isolated functions
- **Done:** `withRazorpayRetry()` — retry once, flag unresolved on failure (Step 9 partial)
- Mock mode when keys missing; real order creation when configured

## Phase 4 — Buyer agent + policy (Steps 5–5.5)
- **Done:** Agent tools: `checkTrust`, `authorizeOrCapture`, `refuse`
- **Done:** `applyUserPolicy()` — independent second gate after trust
- **Tests:** `src/lib/policy/__tests__/applyUserPolicy.test.ts`
- API: `POST /api/purchase` (agent), `POST /api/evaluate` (deterministic)

## Phase 5 — Explanation + audit (Steps 6–7)
- **Done:** `generateExplanation()` — OpenAI with deterministic fallback
- **Done:** Audit logger — in-memory + `data/audit-log.json` persistence
- API: `GET /api/audit-log`, `GET /api/sellers`

## Next up
- Step 8: Frontend (chat, score panel, log feed, policy display)
- Step 9: Full Razorpay failure path integration in agent flow

## Repository
- GitHub: https://github.com/Ishan-Malhotra/trustgate
- Pushed after steps 1–7 complete (commit `8e5a7fc`)
