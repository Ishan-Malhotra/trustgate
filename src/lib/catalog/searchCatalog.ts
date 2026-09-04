import { searchIndiamart } from "@/lib/catalog/providers/indiamart"
import type {
  CatalogCandidate,
  CatalogEvaluatedCandidate,
  CatalogEvaluationResult,
} from "@/lib/catalog/types"
import type { AgentContext } from "@/lib/agent/context"
import { runLookupUnknownMerchant } from "@/lib/agent/lookupUnknownMerchant"
import { logAudit } from "@/lib/audit/logger"
import type { UserPolicy } from "@/lib/types"

/** Cap MCA round-trips for live demo latency. */
export const MAX_CATALOG_CANDIDATES = 3

export interface SearchCatalogInput {
  query: string
  budget?: number
}

/**
 * Catalog infrastructure: search → normalize → ask TrustGate.
 * Does not invent trust or rank for purchase; ShoppingAgent ranks by action then price.
 */
export async function search_catalog(
  input: SearchCatalogInput,
  ctx: AgentContext,
  userPolicy: UserPolicy
): Promise<CatalogEvaluationResult> {
  const query = input.query.trim()
  const usedDefaultBudget = input.budget === undefined
  const budget = input.budget ?? userPolicy.max_spend_per_transaction
  const budgetNote = usedDefaultBudget
    ? `no budget specified, using your default limit of ₹${budget}`
    : undefined

  const rawCandidates = await searchIndiamart(query)
  if (rawCandidates.length === 0) {
    const summary = `No suppliers found in the catalog for "${query}".`
    logAudit("agent", `[search_catalog] ${summary}`, { query })
    return {
      query,
      budget,
      usedDefaultBudget,
      budgetNote,
      candidates: [],
      noSuppliers: true,
      summary: budgetNote ? `${summary} (${budgetNote})` : summary,
    }
  }

  const shortlist = rawCandidates.slice(0, MAX_CATALOG_CANDIDATES)
  const evaluated: CatalogEvaluatedCandidate[] = []

  for (const candidate of shortlist) {
    const amountUsed = resolveAmount(candidate, budget)
    const decision = await runLookupUnknownMerchant(ctx, userPolicy, {
      name: candidate.merchantName,
      amount: amountUsed,
      gstin: candidate.gstin ?? undefined,
    })

    const row: CatalogEvaluatedCandidate = {
      candidate,
      amountUsed,
      sellerId: decision.sellerId,
      recommendedAction: decision.recommendedAction,
      effectiveScore: decision.effectiveScore,
      effectiveTier: decision.effectiveTier,
      riskScore: decision.riskScore,
      confidenceBand: decision.confidenceBand,
      trustReason: decision.trustReason,
    }
    evaluated.push(row)

    logAudit(
      "agent",
      `[search_catalog] Candidate ${candidate.merchantName} @ ₹${candidate.amount ?? "n/a"} → TrustGate ${decision.recommendedAction}`,
      {
        merchantName: candidate.merchantName,
        listingPrice: candidate.amount,
        amountUsed,
        source: candidate.source,
        sellerId: decision.sellerId,
        action: decision.recommendedAction,
        effectiveScore: decision.effectiveScore,
        effectiveTier: decision.effectiveTier,
        riskScore: decision.riskScore,
        confidenceBand: decision.confidenceBand,
      }
    )
  }

  logAudit(
    "agent",
    `[search_catalog] Evaluated ${evaluated.length} candidate(s) for "${query}" — ranking deferred to ShoppingAgent`,
    { query, evaluated: evaluated.length }
  )

  return {
    query,
    budget,
    usedDefaultBudget,
    budgetNote,
    candidates: evaluated,
    noSuppliers: false,
  }
}

function resolveAmount(candidate: CatalogCandidate, budget: number): number {
  if (candidate.amount !== null && candidate.amount > 0) {
    return candidate.amount
  }
  return budget
}
