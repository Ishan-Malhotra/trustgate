import type { AgentContext } from "@/lib/agent/context"
import { runLookupUnknownMerchant } from "@/lib/agent/lookupUnknownMerchant"
import { logAudit } from "@/lib/audit/logger"
import type {
  CatalogCandidate,
  CatalogEvaluatedCandidate,
} from "@/lib/catalog/types"
import type { UserPolicy } from "@/lib/types"
import { candidateToProposal } from "@/lib/trustgate/agentProposal"
import { checkProductIntegrity } from "@/lib/trustgate/productIntegrity"
import { checkPriceIntegrity } from "@/lib/trustgate/priceIntegrity"
import { assessShoppingReliability } from "@/lib/trustgate/shoppingReliability"

type TrustAction = "capture" | "hold" | "refuse"

function worseAction(a: TrustAction, b: TrustAction): TrustAction {
  const rank = { refuse: 2, hold: 1, capture: 0 }
  return rank[a] >= rank[b] ? a : b
}

function resolveAmount(candidate: CatalogCandidate, budget: number): number {
  if (candidate.amount !== null && candidate.amount > 0) return candidate.amount
  return budget
}

/**
 * TrustGate harness: product → price → existing seller/policy.
 * ShoppingAgent proposals are untrusted claims.
 */
export async function evaluateCatalogProposals(
  userRequest: string,
  candidates: CatalogCandidate[],
  ctx: AgentContext,
  userPolicy: UserPolicy,
  budget: number
): Promise<{
  evaluated: CatalogEvaluatedCandidate[]
  shoppingReliability: ReturnType<typeof assessShoppingReliability>
}> {
  const proposals = candidates.map(candidateToProposal)

  // Pass 1: product integrity for all
  const productResults = proposals.map((p) =>
    checkProductIntegrity(userRequest, p)
  )

  for (let i = 0; i < candidates.length; i++) {
    const pi = productResults[i]
    const c = candidates[i]
    const label = c.productName ?? c.merchantName
    if (pi.match) {
      logAudit(
        "trust_check",
        `[product] ✓ Product match — Agent proposed: ${label} — Requested: ${pi.requested}`,
        { seller: c.merchantName, productName: c.productName }
      )
    } else {
      logAudit(
        "trust_check",
        `[product] ✕ Product mismatch — Agent proposed: ${label} — ${pi.reason} → REFUSE → ₹0 to Razorpay`,
        { seller: c.merchantName, productName: c.productName, reason: pi.reason }
      )
    }
  }

  // Pass 2: price integrity using product-matching peers
  const matchingIndexes = productResults
    .map((r, i) => (r.match ? i : -1))
    .filter((i) => i >= 0)

  const priceResults = proposals.map((p, i) => {
    if (!productResults[i].match) {
      return {
        quotedPrice: p.price ?? 0,
        anomaly: "none" as const,
        reason: "Skipped price check — product integrity already refused.",
      }
    }
    if (p.price === null || !(p.price > 0)) {
      return {
        quotedPrice: 0,
        anomaly: "none" as const,
        reason:
          "Price integrity: no listing price on proposal — skipped peer check (seller path uses budget amount).",
      }
    }
    const otherPeers = matchingIndexes
      .filter((j) => j !== i)
      .map((j) => candidates[j].amount)
      .filter((price): price is number => price !== null && price > 0)
    return checkPriceIntegrity(p.price, otherPeers)
  })

  for (let i = 0; i < candidates.length; i++) {
    if (!productResults[i].match) continue
    const price = priceResults[i]
    const c = candidates[i]
    const label = c.productName ?? c.merchantName
    if (price.anomaly === "extreme") {
      const range = price.referenceRange
        ? `Other matching listings: ₹${price.referenceRange.min}–₹${price.referenceRange.max}`
        : ""
      logAudit(
        "trust_check",
        `[price] ⚠ Extreme price anomaly — Agent proposed: ${label} — ₹${price.quotedPrice}. ${range} → REFUSE → ₹0 to Razorpay`,
        { seller: c.merchantName, anomaly: price.anomaly, reason: price.reason }
      )
    } else if (price.anomaly === "moderate") {
      logAudit(
        "trust_check",
        `[price] ⚠ Moderate price anomaly — ${label} — ₹${price.quotedPrice} → floor HOLD`,
        { seller: c.merchantName, anomaly: price.anomaly, reason: price.reason }
      )
    } else {
      logAudit(
        "trust_check",
        `[price] ✓ Price OK — ${label} — ₹${price.quotedPrice}`,
        { seller: c.merchantName, anomaly: price.anomaly }
      )
    }
  }

  // Pass 3: seller/policy for survivors; merge actions
  const evaluated: CatalogEvaluatedCandidate[] = []

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    const amountUsed = resolveAmount(candidate, budget)
    const productIntegrity = productResults[i]
    const priceIntegrity = priceResults[i]

    if (!productIntegrity.match || priceIntegrity.anomaly === "extreme") {
      evaluated.push({
        candidate,
        amountUsed,
        recommendedAction: "refuse",
        trustReason: !productIntegrity.match
          ? productIntegrity.reason
          : priceIntegrity.reason,
        productIntegrity,
        priceIntegrity,
      })
      continue
    }

    const decision = await runLookupUnknownMerchant(ctx, userPolicy, {
      name: candidate.merchantName,
      amount: amountUsed,
      gstin: candidate.gstin ?? undefined,
    })

    let action = decision.recommendedAction as TrustAction
    if (priceIntegrity.anomaly === "moderate") {
      action = worseAction(action, "hold")
    }

    evaluated.push({
      candidate,
      amountUsed,
      sellerId: decision.sellerId,
      recommendedAction: action,
      effectiveScore: decision.effectiveScore,
      effectiveTier: decision.effectiveTier,
      riskScore: decision.riskScore,
      confidenceBand: decision.confidenceBand,
      trustReason: decision.trustReason,
      productIntegrity,
      priceIntegrity,
    })

    logAudit(
      "agent",
      `[search_catalog] Candidate ${candidate.merchantName} @ ₹${candidate.amount ?? "n/a"} → TrustGate ${action}`,
      {
        merchantName: candidate.merchantName,
        productName: candidate.productName,
        listingPrice: candidate.amount,
        amountUsed,
        action,
        productMatch: productIntegrity.match,
        priceAnomaly: priceIntegrity.anomaly,
      }
    )
  }

  const shoppingReliability = assessShoppingReliability(evaluated, ctx)
  if (shoppingReliability.level !== "none") {
    logAudit(
      "agent",
      `[warning] ${shoppingReliability.message}`,
      {
        level: shoppingReliability.level,
        badProposalCount: shoppingReliability.badProposalCount,
        totalProposals: shoppingReliability.totalProposals,
        details: shoppingReliability.details,
      }
    )
  }

  return { evaluated, shoppingReliability }
}
