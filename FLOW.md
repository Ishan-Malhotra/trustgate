# TrustGate flow

End-to-end path of one purchase request: chat → gates → agent tools → trust/policy → Razorpay or refuse.

Shopping finds the deal. TrustGate decides whether money can move. The LLM prompt cannot override a stored decision.

---

## Entire request

```mermaid
flowchart TD
  user[User message<br/>chat or demo chip] --> control{Control unlocked?}
  control -->|no| locked[503 locked<br/>Vercel, no secret]
  control -->|yes| kill{Kill switch on?}
  kill -->|yes| stopped[Stop · no Razorpay]
  kill -->|no| agent[Buyer agent<br/>Claude picks a tool]

  agent --> seed[checkTrust<br/>seed seller id]
  agent --> live[lookupUnknownMerchant<br/>named company]
  agent --> catalog[search_catalog<br/>IndiaMART]

  seed --> load[Load sellers.json<br/>no MCA, no GST]
  load --> score

  live --> mca{MCA hit?}
  mca -->|hit| conf
  mca -->|miss| gstq{GSTIN present?}
  gstq -->|yes| gstr[Verify GST<br/>retry MCA with legal name]
  gstq -->|no| conf
  gstr --> conf[Confidence + GST overlay<br/>GST cannot invent an MCA hit]
  conf --> score

  catalog --> scrape[Normalize listings<br/>untrusted proposals]
  scrape --> prod{Product matches?}
  prod -->|no| mismatch[Refuse candidate<br/>wrong SKU / accessory]
  prod -->|yes| price[Price check — soft<br/>skip if pool under 5]
  price --> per[Same live TrustGate<br/>per candidate]
  per --> score

  score[scoreSeller<br/>risk 0–100] --> eval[evaluateTrust<br/>first-match action]
  eval --> policy[applyUserPolicy<br/>downgrade only]
  policy --> store[Store decision<br/>by this sellerId]

  store --> rank{Catalog: any CAPTURE?}
  rank -->|yes| authz[authorized<br/>cheapest capture]
  rank -->|no| holdc[requires_confirmation<br/>do not auto-pay]
  authz --> payq
  store --> payq

  payq{Pay this seller?} -->|no| refuse[refuse tool<br/>no Razorpay]
  payq -->|yes| gate{Payment gate ok?}
  gate -->|no| blocked[Gate blocks<br/>payment-gate]
  gate -->|yes| rzp[Razorpay<br/>order → auth → capture?]
  rzp --> explain
  refuse --> explain
  blocked --> explain
  holdc --> explain
  mismatch --> explain
  locked --> explain
  stopped --> explain
  explain[Explain + audit<br/>chat UI updates]
```

**Catalog HOLD is not seed HOLD.** Seed / live-lookup HOLD still authorizes on Razorpay. Catalog `requires_confirmation` does not auto-pay in that request.

---

## Seed catalog

Used when the agent matches a merchant in `data/sellers.json`.

```mermaid
flowchart TD
  user[User message] --> agent[Buyer agent]
  agent --> check[checkTrust sellerId, amount]
  check --> load[Load seed seller]
  load --> score[scoreSeller — no confidence object]
  score --> eval[evaluateTrust]
  eval --> policy[applyUserPolicy]
  policy --> store[Store decisionsBySellerId]
  store --> pay{authorizeOrCapture?}
  pay -->|yes| gate[assertPaymentAuthorized]
  gate --> rzp[Razorpay capture or authorize-only]
  pay -->|no| refuse[refuse · no Razorpay]
```

Examples: Spice Garden capture, Blue Bottle policy hold at ₹450, DealDash dispute-spike refuse.

---

## Live MCA / GST

Used when the payee is a real company not in the seed file.

```mermaid
flowchart TD
  user[Pay Infosys ₹250] --> lookup[lookupUnknownMerchant]
  lookup --> mca[searchCompanyDetailed<br/>exact + fuzzy ≥ 0.72]
  mca --> hit{MCA record?}
  hit -->|yes| gstMaybe[If GSTIN: verify for overlay]
  hit -->|no| gstin{GSTIN on input?}
  gstin -->|yes| verify[verifyGstin]
  verify --> retry[Retry MCA with GST legal name]
  retry --> gstMaybe
  gstin -->|no| miss[Low confidence ~15]
  gstMaybe --> overlay[applyGstConfidenceOverlay]
  miss --> overlay
  overlay --> seller[sellerFromMca]
  seller --> score[scoreSeller + confidence]
  score --> eval[evaluateTrust]
  eval --> policy[applyUserPolicy]
  policy --> store[Store live:CIN decision]

  overlay -.->|Active GST on still-missing MCA| trial[Stay low-band<br/>HOLD ₹200 trial]
  overlay -.->|Cancelled / suspended GST| adverse[adverseStatus → REFUSE]
```

GST is an identity bridge, not a substitute for MCA. Active GST cannot promote a miss into capture.

---

## Catalog / ShoppingAgent

Used when the product is outside seed listings. Needs `APIFY_TOKEN`.

```mermaid
flowchart TD
  user[Buy white Star Wars t-shirt] --> search[search_catalog]
  search --> indiamart[IndiaMART via Apify]
  indiamart --> norm[Normalize CatalogCandidate]
  norm --> prod{Product integrity}
  prod -->|fail| refuseCand[REFUSE candidate · ₹0]
  prod -->|pass| price{Priced matches ≥ 5?}
  price -->|no| skip[Skip anomaly check<br/>audit only]
  price -->|yes| soft[Soft extreme/moderate flag<br/>never standalone refuse]
  skip --> live
  soft --> live[Per candidate: MCA/GST/trust/policy]
  live --> rel[Shopping reliability warning?]
  rel --> rank{Any candidate CAPTURE?}
  rank -->|yes| auth[Status authorized<br/>cheapest capture]
  rank -->|no, has HOLD| conf[Status requires_confirmation<br/>do not call payment tools]
  rank -->|none| none[no_viable / no_suppliers]
  auth --> gate[Payment gate: capture chosen catalog seller only]
  conf --> ask[Ask the user in chat]
```

---

## evaluateTrust — first match wins

Runs after `scoreSeller`. Live paths also apply confidence risk overrides and a registry floor before this chain.

```mermaid
flowchart TD
  start[Effective score + tier<br/>+ spend limit] --> r1{Adverse MCA / GST?}
  r1 -->|yes| refuse1[REFUSE]
  r1 -->|no| r2{Confidence band low?}
  r2 -->|yes| hold200[HOLD · cap ₹200]
  r2 -->|no| r3{Spend limit = 0?}
  r3 -->|yes| refuse2[REFUSE<br/>seed low tier]
  r3 -->|no| r4{Amount over trust cap?}
  r4 -->|yes| holdCap[HOLD at cap]
  r4 -->|no| r5{Low tier + high MCA<br/>+ bad transaction signals?}
  r5 -->|yes| refuse3[REFUSE]
  r5 -->|no| r6{High MCA + history-only gap?}
  r6 -->|yes| capReg[CAPTURE<br/>Infosys path]
  r6 -->|no| r7{Effective low or medium?}
  r7 -->|yes| holdTier[HOLD]
  r7 -->|no| capHigh[CAPTURE<br/>high effective tier]
```

Then **`applyUserPolicy`** (downgrade only):

```mermaid
flowchart TD
  trust[Trust action] --> p1{Amount over max per transaction?}
  p1 -->|yes| refuse[REFUSE]
  p1 -->|no| p2{Amount over max per seller?}
  p2 -->|yes| refuse
  p2 -->|no| p3{Capture and over confirm-above?}
  p3 -->|yes| hold[HOLD]
  p3 -->|no| keep[Keep trust action]
```

---

## Payment gate

`assertPaymentAuthorized` runs inside `authorizeOrCapture` before any Razorpay call. The prompt is not enough.

```mermaid
flowchart TD
  tool[authorizeOrCapture] --> kill{Kill switch?}
  kill -->|on| stop[Block · ₹0]
  kill -->|off| dec{Decision for this sellerId?}
  dec -->|no| miss[Must check trust first]
  dec -->|yes| shop{This seller was in last catalog search?}
  shop -->|no| match[Independent seed / live-lookup<br/>catalog status does not lock]
  shop -->|yes| st{Catalog status}
  st -->|requires_confirmation / no_viable / no_suppliers| blockShop[Do not pay catalog sellers]
  st -->|authorized| chosen{This is the chosen seller<br/>and action is capture?}
  chosen -->|no| blockOther[Wrong seller or wrong action]
  chosen -->|yes| match
  match --> act{Tool action = stored action?}
  act -->|no| mismatch[capture cannot override hold]
  act -->|yes| lim{Amount ≤ spend limit?}
  lim -->|no| over[Exceeds spend limit]
  lim -->|yes| ok[Pay effectiveAmount]
  ok --> rzp[createOrder → authorizeOnly<br/>→ capture if action is capture]
```

If Razorpay times out or errors: retry once (~8s), then mark **flagged / unresolved** in the audit log.

---

## Outcomes

| Outcome | Razorpay |
|---------|----------|
| Capture | Authorize and take the money |
| Hold (seed / live-lookup) | Authorize only |
| Hold (catalog `requires_confirmation`) | No payment in this request |
| Refuse, kill switch, or payment-gate reject | No Razorpay call |
