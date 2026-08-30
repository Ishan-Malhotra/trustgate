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
- **Done:** `generateExplanation()` — Anthropic Claude with deterministic fallback
- **Done:** Audit logger — in-memory + `data/audit-log.json` persistence
- API: `GET /api/audit-log`, `GET /api/sellers`

## Phase 6 — Frontend (Step 8)
- **Done:** Chat panel with purchase requests + quick demo buttons
- **Done:** Seller/score panel with tier colors and gaming seller badge
- **Done:** Live audit log feed (refreshes after each request)
- **Done:** User policy display (loaded from API / `userPolicy.ts`)
- Chat always goes through `POST /api/purchase` (Anthropic buyer-agent)
- Buyer agent + explanations use `ANTHROPIC_API_KEY` / Claude Sonnet 4.5

## Phase 7 — Razorpay failure path (Step 9)
- **Done:** 8s timeout on Razorpay calls, retry once, then `flagged` unresolved audit entry
- **Done:** Shared `executeApprovedPayment()` used by evaluate API and agent tools
- **Done:** Chat now sends `executePayment: true` so approved/held requests hit Razorpay
- **Done:** No silent capture success — capture only runs on real `pay_` ids
- **Tests:** `src/lib/razorpay/__tests__/retry.test.ts`

## Phase 8 — Hide pre-decision scores; goal-based agent choice
- **Done:** Seller panel is "Available Sellers" (name, category, listings/price only) until the agent evaluates
- **Done:** Scores/tier/limit reveal in chat comparison + only for sellers checked in that request
- **Done:** Dev mode toggle (off by default) reloads `/api/sellers?dev=1` with full scores for debugging
- **Done:** Demo buttons are goal-based (no seller names). Phone-case cheapest listing is the gaming seller
- **Done:** Agent prompt requires checkTrust on every relevant seller, then explain the price/trust tradeoff
- **Done:** Payment tool uses per-seller trust decision (not just the last checkTrust)

## Repository
- GitHub: https://github.com/Ishan-Malhotra/trustgate
