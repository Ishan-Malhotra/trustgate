import { searchIndiamart } from "@/lib/catalog/providers/indiamart"
import type { CatalogEvaluationResult } from "@/lib/catalog/types"
import type { AgentContext } from "@/lib/agent/context"
import { evaluateCatalogProposals } from "@/lib/trustgate/evaluateCatalogProposals"
import { logAudit } from "@/lib/audit/logger"
import type { UserPolicy } from "@/lib/types"

/** Cap MCA round-trips for live demo latency. */
export const MAX_CATALOG_CANDIDATES = 3

export interface SearchCatalogInput {
  query: string
  budget?: number
}

/**
 * Catalog infrastructure: search → normalize → TrustGate proposal evaluation.
 * ShoppingAgent ranks only TrustGate-permitted actions.
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
  const { evaluated, shoppingReliability } = await evaluateCatalogProposals(
    query,
    shortlist,
    ctx,
    userPolicy,
    budget
  )

  logAudit(
    "agent",
    `[search_catalog] Evaluated ${evaluated.length} candidate(s) for "${query}" — ranking deferred to ShoppingAgent`,
    {
      query,
      evaluated: evaluated.length,
      reliability: shoppingReliability.level,
    }
  )

  return {
    query,
    budget,
    usedDefaultBudget,
    budgetNote,
    candidates: evaluated,
    noSuppliers: false,
    shoppingReliability,
  }
}
