import { searchIndiamart } from "@/lib/catalog/providers/indiamart"
import type {
  CatalogCandidate,
  CatalogEvaluatedCandidate,
  CatalogSearchResult,
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
 * Catalog infrastructure: search → normalize → ask TrustGate → rank approved.
 * Does not invent trust; TrustGate decides each candidate.
 */
export async function search_catalog(
  input: SearchCatalogInput,
  ctx: AgentContext,
  userPolicy: UserPolicy
): Promise<CatalogSearchResult> {
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
      status: "no_suppliers",
      query,
      budget,
      usedDefaultBudget,
      budgetNote,
      candidates: [],
      approved: [],
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

  const approved = evaluated.filter((row) => row.recommendedAction !== "refuse")
  const chosen = pickCheapestApproved(approved)

  if (!chosen) {
    const summary = buildNoViableSummary(query, evaluated, budgetNote)
    logAudit("agent", `[search_catalog] ${summary}`, {
      query,
      evaluated: evaluated.length,
    })
    return {
      status: "no_viable",
      query,
      budget,
      usedDefaultBudget,
      budgetNote,
      candidates: evaluated,
      approved: [],
      summary,
    }
  }

  ctx.chosenSellerId = chosen.sellerId
  const summary = buildChosenSummary(query, chosen, approved, evaluated, budgetNote)
  logAudit("agent", `[search_catalog] ${summary}`, {
    query,
    chosenSellerId: chosen.sellerId,
    chosenName: chosen.candidate.merchantName,
  })

  return {
    status: "ok",
    query,
    budget,
    usedDefaultBudget,
    budgetNote,
    candidates: evaluated,
    approved,
    chosen,
    summary,
  }
}

function resolveAmount(candidate: CatalogCandidate, budget: number): number {
  if (candidate.amount !== null && candidate.amount > 0) {
    return candidate.amount
  }
  return budget
}

function pickCheapestApproved(
  approved: CatalogEvaluatedCandidate[]
): CatalogEvaluatedCandidate | undefined {
  if (approved.length === 0) return undefined

  const priced = approved.filter(
    (row) => row.candidate.amount !== null && row.candidate.amount > 0
  )
  if (priced.length === 0) return approved[0]

  return priced.reduce((best, row) =>
    (row.candidate.amount as number) < (best.candidate.amount as number)
      ? row
      : best
  )
}

function buildNoViableSummary(
  query: string,
  evaluated: CatalogEvaluatedCandidate[],
  budgetNote?: string
): string {
  const lines = evaluated.map(
    (row) =>
      `- ${row.candidate.merchantName} (₹${row.candidate.amount ?? "n/a"}): TrustGate ${row.recommendedAction}`
  )
  const base = `No viable seller found for "${query}" — catalog returned candidates but none were TrustGate-approved.\n${lines.join("\n")}`
  return budgetNote ? `${base}\n(${budgetNote})` : base
}

function buildChosenSummary(
  query: string,
  chosen: CatalogEvaluatedCandidate,
  approved: CatalogEvaluatedCandidate[],
  evaluated: CatalogEvaluatedCandidate[],
  budgetNote?: string
): string {
  const refused = evaluated.filter((row) => row.recommendedAction === "refuse")
  const alt = approved
    .filter((row) => row.sellerId !== chosen.sellerId)
    .map((row) => {
      const price = row.candidate.amount
      const cheaper =
        price !== null &&
        chosen.candidate.amount !== null &&
        price < chosen.candidate.amount
      return `${row.candidate.merchantName} (₹${price ?? "n/a"}${cheaper ? ", cheaper but not chosen" : ""}, TrustGate ${row.recommendedAction})`
    })

  const parts = [
    `Catalog search for "${query}" evaluated ${evaluated.length} candidate(s).`,
    ...evaluated.map(
      (row) =>
        `- ${row.candidate.merchantName}: listing ₹${row.candidate.amount ?? "n/a"}, TrustGate ${row.recommendedAction}` +
        (row.effectiveScore !== undefined
          ? ` (effective ${row.effectiveScore}/${row.effectiveTier})`
          : "")
    ),
    `Chose ${chosen.candidate.merchantName} @ ₹${chosen.candidate.amount ?? chosen.amountUsed} — TrustGate ${chosen.recommendedAction}` +
      (chosen.trustReason ? `; ${chosen.trustReason}` : ""),
  ]

  if (refused.length > 0) {
    parts.push(
      `Filtered ${refused.length} refused candidate(s): ${refused.map((r) => r.candidate.merchantName).join(", ")}.`
    )
  }
  if (alt.length > 0) {
    parts.push(`Other approved options: ${alt.join("; ")}.`)
  }
  if (budgetNote) parts.push(`(${budgetNote})`)

  return parts.join("\n")
}
