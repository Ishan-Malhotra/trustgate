# TrustGate Build Log

## Phase 1 — Seller seed data (Step 1)
- **Done:** `data/sellers.json` with 8 sellers (7 legitimate + 1 adversarial `seller-gaming`)
- Gaming seller has dispute history that starts clean then spikes: `[0.01, 0.015, 0.02, 0.18, 0.42]`
- Seller loader at `src/lib/sellers.ts`
- **Later:** public `listings` (item + INR price) and `known_for` tags so the agent can match goals without seeing scores. Cheapest phone case is DealDash at ₹89 (gaming-detection demo)

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
- **Later:** system prompt is goal-based; `checkTrust` on every relevant seller; `authorizeOrCapture` uses that seller’s stored decision, not only the last check

## Phase 5 — Explanation + audit (Steps 6–7)
- **Done:** `generateExplanation()` — Anthropic Claude with deterministic fallback; comparison-aware when multiple sellers were checked
- **Done:** Audit logger — in-memory + `data/audit-log.json` persistence
- API: `GET /api/audit-log`, `GET /api/sellers` (scores only with `?dev=1`)

## Phase 6 — Frontend (Step 8)
- **Done:** Chat panel with goal-based purchase requests + quick demo buttons (no seller names)
- **Done:** Available Sellers panel: name, category, prices. Scores hidden until the agent evaluates those sellers
- **Done:** Live audit log feed (refreshes after each request)
- **Done:** User policy display (loaded from API / `userPolicy.ts`)
- Chat always goes through `POST /api/purchase` (Anthropic buyer-agent)
- Buyer agent + explanations use `ANTHROPIC_API_KEY` / Claude Sonnet 4.5
- Optional workspace header via `ANTHROPIC_WORKSPACE_ID` for identity-linked keys

## Phase 7 — Razorpay failure path (Step 9)
- **Done:** 8s timeout on Razorpay calls, retry once, then `flagged` unresolved audit entry
- **Done:** Shared `executeApprovedPayment()` used by evaluate API and agent tools
- **Done:** Agent payment tool executes Razorpay on approve/hold (no silent capture on mock/`auth_pending_` ids)
- **Tests:** `src/lib/razorpay/__tests__/retry.test.ts`

## Phase 8 — Hide pre-decision scores; goal-based agent choice
- **Done:** Seller panel renamed “Available Sellers”; no score/tier/limit/gaming badge in the default demo view
- **Done:** After a decision, chat shows per-seller comparison (price, score, tier, action)
- **Done:** Side panel reveals scores only for sellers `checkTrust`’d in that request
- **Done:** Dev mode toggle (off by default) fetches `/api/sellers?dev=1` for our debugging
- **Done:** Demo buttons: cheapest banana bread; Indian food safely; phone case best price; coffee tasting ~₹450 (policy hold)
- **Done:** Default `GET /api/sellers` omits score fields so the catalog cannot be eyeballed as a ranked list

## Phase 9 — Live MCA lookup + confidence-based spend
- **Done:** `searchCompany()` — data.gov.in MCA Company Master Data API, exact name/CIN filters, suffix retries, in-memory cache, graceful null on errors
- **Done:** `computeConfidence()` — separate confidence band from risk; adverse MCA status elevates risk independently
- **Done:** `scoreSeller()` empty-history guard — `dispute_rate_history: []` is unknown, not maximal-clean
- **Done:** `evaluateTrust(seller, amount, confidence?)` — low confidence → ₹200 trial hold ("insufficient verifiable history")
- **Done:** Agent tool `lookupUnknownMerchant`; seed catalog path unchanged
- **Done:** Audit log `[live-lookup]` highlighted in UI; Infosys demo button
- **Env:** `DATA_GOV_IN_API_KEY` (optional)
- **Tests:** confidence, empty-history regression, mcaLookup (mocked fetch)
- **Next step:** GST verification; fuzzy MCA name matching
- **Fix:** High MCA confidence + unverified transaction history → capture (not medium-tier hold); structured reasoning chain in audit log
- **Fix:** `getSpendLimit()` no longer refuses low-tier merchants before checking confidence — high/medium registry confidence now sets a spend ceiling instead of returning 0; registry-verified capture applies to low tier too
- **Done:** Editable user policy panel — changes persist via `PUT /api/config` and apply on the next purchase immediately
- **Done:** Audit log layout — scroll contained in viewport; sellers panel capped so log stays on screen

## Repository
- GitHub: https://github.com/Ishan-Malhotra/trustgate
- README: [README.md](./README.md)
