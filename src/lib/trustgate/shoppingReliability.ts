import type {
  CatalogEvaluatedCandidate,
  ShoppingReliabilityTrigger,
  ShoppingReliabilityWarning,
} from "@/lib/catalog/types"
import type { AgentContext } from "@/lib/agent/context"

export const UNRELIABLE_FAILURE_RATE = 0.5
export const UNRELIABLE_ACCUMULATED = 3

export function assessShoppingReliability(
  candidates: CatalogEvaluatedCandidate[],
  ctx?: AgentContext
): ShoppingReliabilityWarning {
  const totalProposals = candidates.length
  const triggers = new Set<ShoppingReliabilityTrigger>()
  const details: string[] = []
  let badProposalCount = 0

  for (const row of candidates) {
    const product = row.productIntegrity
    const price = row.priceIntegrity
    let bad = false

    if (product && !product.match) {
      bad = true
      triggers.add("product_mismatch")
      details.push(
        `✕ Product mismatch — ${row.candidate.productName ?? row.candidate.merchantName}: ${product.reason}`
      )
    }

    if (price && price.anomaly === "extreme") {
      bad = true
      triggers.add("extreme_price")
      const range = price.referenceRange
        ? ` peers ₹${price.referenceRange.min}–₹${price.referenceRange.max}`
        : ""
      details.push(
        `⚠ Extreme price anomaly — ${row.candidate.productName ?? row.candidate.merchantName} ₹${price.quotedPrice}${range}`
      )
    }

    if (bad) badProposalCount += 1
  }

  if (ctx) {
    ctx.shoppingIntegrityFailureCount =
      (ctx.shoppingIntegrityFailureCount ?? 0) + badProposalCount
  }

  const failureRate = totalProposals > 0 ? badProposalCount / totalProposals : 0
  const accumulated = ctx?.shoppingIntegrityFailureCount ?? badProposalCount

  let level: ShoppingReliabilityWarning["level"] = "none"
  if (failureRate >= UNRELIABLE_FAILURE_RATE || accumulated >= UNRELIABLE_ACCUMULATED) {
    level = "unreliable"
  } else if (badProposalCount >= 1) {
    level = "caution"
  }

  let message = ""
  if (level === "caution") {
    message =
      "TrustGate intervening: blocked bad shopping proposal(s) (product mismatch and/or extreme price). The shopping agent’s pick was not trusted."
  } else if (level === "unreliable") {
    message =
      "Warning: the shopping agent is repeatedly proposing invalid or unsafe deals. TrustGate is intervening and will not send money for those proposals — shopping source appears unreliable."
  }

  return {
    level,
    badProposalCount,
    totalProposals,
    failureRate,
    message,
    triggers: [...triggers],
    details,
  }
}
