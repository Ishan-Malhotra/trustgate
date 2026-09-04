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

## Phase 9b — Registry trust floor + raw vs effective scoring
- **Done:** `noHistoryPenalty` waived at source when `confidence.band === "high"` and signals are history-only (`trustSignals.ts`)
- **Done:** Registry trust floor in `evaluateTrust` — effective score floored to 75 (level ≥80) or 55; `riskScore`/`riskTier` vs `effectiveScore`/`effectiveTier` on all decisions
- **Done:** `getSpendLimit` bypasses low-tier cap for high-confidence history-only merchants — uses normal high-tier limits (₹3000+)
- **Done:** Audit, reasoning chain, explanation, and chat UI show both raw and effective scores when they differ
- **Done:** MCA lookup hardening — verified session cache, CIN retry, non-poisoning on API errors, `searchCompanyDetailed()` with distinct failure reasons
- **Tests:** Infosys ₹500 capture, verified+bad-signals refuse, MCA verified-cache fallback, dual-score audit

## Phase 10 — Catalog provider + Shopping Agent (TrustGate stays the gate)
- **Architecture:** Shopping Agent finds deals; Catalog Provider searches/normalizes; TrustGate alone decides if a deal can be transacted
- **Flow:** `search → normalize → ask TrustGate → ShoppingAgent CAPTURE-first rank → return` (tool/API: `search_catalog`, not `shopForProduct`)
- **Done:** `src/lib/catalog/` — types, IndiaMART provider (Apify), `search_catalog()` evaluate-only (TrustGate per candidate)
- **Done:** Shared `runLookupUnknownMerchant` extracted; existing live-lookup tool unchanged in behavior
- **Done:** `shoppingAgent.ts` CAPTURE-first ranking; statuses `authorized` / `requires_confirmation` / `no_viable`; HOLD never auto-purchased
- **Done:** BuyerAgent + tool copy follow shopping status; seed/Infosys flows unchanged
- **Done:** Demo chip “Buy white Star Wars t-shirt”; loading label for catalog search; audit highlights `[search_catalog]` / `[shopping]`
- **Env:** `APIFY_TOKEN`, `APIFY_INDIAMART_ACTOR_ID` (default `sourabhbgp~indiamart-scraper`; `makework36~indiamart-suppliers-scraper` still supported)
- **Tests:** shoppingAgent hierarchy (CAPTURE beats HOLD, cheapest HOLD, no_viable); search_catalog evaluate-only; IndiaMART mapping/cache/failure
- **Not done here:** Extra providers (ONDC/Shopify), shopping-side trust/GST approval, hardcoded fallback suppliers
- **Still next step (day-of risk):** Fuzzy MCA name matching. GST verification **shipped** (format/checksum + optional legal-name MCA retry). Re-tested 2026-09-03: Star Wars chip ≈2/5 exact MCA hits (Berryblues, ORN); trade names miss without GSTIN. **Set `DATA_GOV_IN_API_KEY`**. Optional `GST_VERIFY_URL` when portal is blocked.

## Phase 11 — GST verification (identity bridge)
- **Done:** `src/lib/gst/validateGstin.ts` — format + mod-36 checksum (no network)
- **Done:** `src/lib/gst/verifyGstin.ts` — portal/proxy lookup, session cache, soft fail → format-only when portal blocked
- **Done:** `applyGstConfidenceOverlay` — GST Active / cancelled overlays MCA confidence (not shopping-side trust)
- **Done:** Live lookup bridge — MCA miss + GSTIN → verify GST → retry MCA with legal name; catalog passes `candidate.gstin`
- **Done:** Audit `[gst]` + progress log; tool `lookupUnknownMerchant` accepts optional `gstin`
- **Env:** optional `GST_VERIFY_URL` (portal often blocked from servers)
- **Tests:** validate/verify/overlay + MCA-miss→GST-legal-name→MCA-hit bridge
- **Note:** IndiaMART search rows often lack GSTIN — bridge helps only when GSTIN is present

## Prep doc
- **Done:** `PREP.md` — full codebase explainer for demo prep (product idea, seed sellers, trust/confidence/policy, agent tools, MCA, Razorpay, UI, demo checklist)
- **Done:** `.cursorrules` updated — after every step/phase, update `PREP.md` so it stays accurate

## Repository
- GitHub: https://github.com/Ishan-Malhotra/trustgate
- README: [README.md](./README.md)
- Prep notes: [PREP.md](./PREP.md)

## Phase 12 — TrustGate proposal integrity + shopping warnings
- **Done:** Product integrity + peer price integrity around catalog proposals (`src/lib/trustgate/`)
- **Done:** Shopping reliability caution/unreliable warnings; demo TrustGate intervening banner
- **Done:** search_catalog evaluates proposals via TrustGate harness; ShoppingAgent ranks permitted only
- **Tests:** product/price/reliability/evaluateCatalogProposals cases (PS5 accessory, extreme ₹200, valid cheapest camera)

## Kill switch — stop all autonomous payments
- **Done:** `src/lib/config/killSwitch.ts` + `/api/kill-switch` — one toggle disables payments instantly
- **Done:** Blocks `/api/purchase` agent runs, `authorizeOrCapture`, and `executeApprovedPayment`
- **Done:** Header button “Stop all payments” / “Resume payments” + status banner; audit `[kill-switch]`
- **Tests:** killSwitch unit tests
