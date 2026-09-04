import { search_catalog } from "@/lib/catalog/searchCatalog"
import type {
  CatalogEvaluatedCandidate,
  CatalogEvaluationResult,
  CatalogSearchResult,
  CatalogSearchStatus,
} from "@/lib/catalog/types"
import type { AgentContext } from "@/lib/agent/context"
import { logAudit } from "@/lib/audit/logger"
import type { UserPolicy } from "@/lib/types"

export interface ShoppingAgentInput {
  query: string
  budget?: number
}

export type ShoppingStatus = CatalogSearchStatus

export type ShoppingAgentResult = CatalogSearchResult & {
  shoppingAgent: true
}

/**
 * ShoppingAgent: find the best product/seller using TrustGate actions as the
 * authorization boundary, then price within each action bucket.
 *
 * CAPTURE (cheapest) → authorized (automatic purchase allowed)
 * else HOLD (cheapest) → requires_confirmation (do NOT auto-purchase)
 * else → no_viable
 */
export async function runShoppingAgent(
  input: ShoppingAgentInput,
  ctx: AgentContext,
  userPolicy: UserPolicy
): Promise<ShoppingAgentResult> {
  const evaluation = await search_catalog(input, ctx, userPolicy)
  const ranked = applyShoppingDecision(evaluation, ctx)
  logAudit("agent", `[shopping] ${ranked.summary}`, {
    status: ranked.status,
    chosenSellerId: ranked.chosen?.sellerId,
    chosenName: ranked.chosen?.candidate.merchantName,
    action: ranked.chosen?.recommendedAction,
  })
  return { ...ranked, shoppingAgent: true }
}

/** Pure ranking — exported for tests. */
export function applyShoppingDecision(
  evaluation: CatalogEvaluationResult,
  ctx?: AgentContext
): CatalogSearchResult {
  const {
    query,
    budget,
    usedDefaultBudget,
    budgetNote,
    candidates,
    noSuppliers,
  } = evaluation

  if (noSuppliers || candidates.length === 0) {
    const summary =
      evaluation.summary ??
      `No suppliers found in the catalog for "${query}".`
    return {
      status: "no_suppliers",
      query,
      budget,
      usedDefaultBudget,
      budgetNote,
      candidates: [],
      approved: [],
      holds: [],
      summary,
      reason: summary,
    }
  }

  const approved = candidates.filter(
    (row) => row.recommendedAction === "capture"
  )
  const holds = candidates.filter((row) => row.recommendedAction === "hold")
  const refused = candidates.filter(
    (row) => row.recommendedAction === "refuse"
  )

  const cheapestCapture = pickCheapestByPrice(approved)
  if (cheapestCapture) {
    if (ctx) ctx.chosenSellerId = cheapestCapture.sellerId
    const summary = buildAuthorizedSummary(
      query,
      cheapestCapture,
      approved,
      holds,
      refused,
      candidates,
      budgetNote
    )
    return {
      status: "authorized",
      query,
      budget,
      usedDefaultBudget,
      budgetNote,
      candidates,
      approved,
      holds,
      chosen: cheapestCapture,
      summary,
      reason: summary,
    }
  }

  const cheapestHold = pickCheapestByPrice(holds)
  if (cheapestHold) {
    if (ctx) ctx.chosenSellerId = cheapestHold.sellerId
    const summary = buildRequiresConfirmationSummary(
      query,
      cheapestHold,
      holds,
      refused,
      candidates,
      budgetNote
    )
    return {
      status: "requires_confirmation",
      query,
      budget,
      usedDefaultBudget,
      budgetNote,
      candidates,
      approved: [],
      holds,
      chosen: cheapestHold,
      summary,
      reason: summary,
    }
  }

  const summary = buildNoViableSummary(query, candidates, budgetNote)
  return {
    status: "no_viable",
    query,
    budget,
    usedDefaultBudget,
    budgetNote,
    candidates,
    approved: [],
    holds: [],
    summary,
    reason: summary,
  }
}

function pickCheapestByPrice(
  rows: CatalogEvaluatedCandidate[]
): CatalogEvaluatedCandidate | undefined {
  if (rows.length === 0) return undefined

  const priced = rows.filter(
    (row) => row.candidate.amount !== null && row.candidate.amount > 0
  )
  if (priced.length === 0) return rows[0]

  return priced.reduce((best, row) =>
    (row.candidate.amount as number) < (best.candidate.amount as number)
      ? row
      : best
  )
}

function actionLabel(action: "capture" | "hold" | "refuse"): string {
  if (action === "capture") return "authorized for automatic purchase"
  if (action === "hold") return "bounded hold / requires confirmation"
  return "transaction refused"
}

function buildAuthorizedSummary(
  query: string,
  chosen: CatalogEvaluatedCandidate,
  approved: CatalogEvaluatedCandidate[],
  holds: CatalogEvaluatedCandidate[],
  refused: CatalogEvaluatedCandidate[],
  evaluated: CatalogEvaluatedCandidate[],
  budgetNote?: string
): string {
  const price = chosen.candidate.amount ?? chosen.amountUsed
  const parts = [
    `Catalog search for "${query}" evaluated ${evaluated.length} candidate(s).`,
    ...evaluated.map(
      (row) =>
        `- ${row.candidate.merchantName}: listing ₹${row.candidate.amount ?? "n/a"}, TrustGate ${row.recommendedAction} (${actionLabel(row.recommendedAction)})` +
        (row.trustReason ? `; ${row.trustReason}` : "")
    ),
    `Chose ${chosen.candidate.merchantName} @ ₹${price} — cheapest seller authorized for automatic purchase (CAPTURE).` +
      (chosen.trustReason ? ` ${chosen.trustReason}` : ""),
    `Status: authorized. BuyerAgent may call authorizeOrCapture with action "capture" for this seller only.`,
  ]

  if (holds.length > 0) {
    parts.push(
      `Skipped ${holds.length} HOLD candidate(s) (cheaper HOLD does not beat CAPTURE): ${holds.map((h) => `${h.candidate.merchantName} ₹${h.candidate.amount ?? "n/a"}`).join(", ")}.`
    )
  }
  if (refused.length > 0) {
    parts.push(
      `Filtered ${refused.length} refused candidate(s): ${refused.map((r) => r.candidate.merchantName).join(", ")}.`
    )
  }
  if (approved.length > 1) {
    const others = approved
      .filter((row) => row.sellerId !== chosen.sellerId)
      .map(
        (row) =>
          `${row.candidate.merchantName} ₹${row.candidate.amount ?? "n/a"}`
      )
    if (others.length > 0) {
      parts.push(`Other CAPTURE options: ${others.join("; ")}.`)
    }
  }
  if (budgetNote) parts.push(`(${budgetNote})`)

  return parts.join("\n")
}

function buildRequiresConfirmationSummary(
  query: string,
  chosen: CatalogEvaluatedCandidate,
  holds: CatalogEvaluatedCandidate[],
  refused: CatalogEvaluatedCandidate[],
  evaluated: CatalogEvaluatedCandidate[],
  budgetNote?: string
): string {
  const price = chosen.candidate.amount ?? chosen.amountUsed
  const parts = [
    `Catalog search for "${query}" evaluated ${evaluated.length} candidate(s).`,
    ...evaluated.map(
      (row) =>
        `- ${row.candidate.merchantName}: listing ₹${row.candidate.amount ?? "n/a"}, TrustGate ${row.recommendedAction} (${actionLabel(row.recommendedAction)})` +
        (row.trustReason ? `; ${row.trustReason}` : "")
    ),
    `No seller was eligible for automatic capture (CAPTURE).`,
    `Recommended constrained option: ${chosen.candidate.merchantName} @ ₹${price} — cheapest HOLD (bounded hold / requires confirmation).` +
      (chosen.trustReason ? ` TrustGate: ${chosen.trustReason}` : ""),
    `Maximum permitted hold amount for this option: ₹${chosen.amountUsed}.`,
    `Status: requires_confirmation. Do NOT call authorizeOrCapture automatically. This is not a completed purchase and not an automatic capture.`,
  ]

  if (holds.length > 1) {
    const others = holds
      .filter((row) => row.sellerId !== chosen.sellerId)
      .map(
        (row) =>
          `${row.candidate.merchantName} ₹${row.candidate.amount ?? "n/a"}`
      )
    if (others.length > 0) {
      parts.push(`Other HOLD options (more expensive): ${others.join("; ")}.`)
    }
  }
  if (refused.length > 0) {
    parts.push(
      `Filtered ${refused.length} refused candidate(s): ${refused.map((r) => r.candidate.merchantName).join(", ")}.`
    )
  }
  if (budgetNote) parts.push(`(${budgetNote})`)

  return parts.join("\n")
}

function buildNoViableSummary(
  query: string,
  evaluated: CatalogEvaluatedCandidate[],
  budgetNote?: string
): string {
  const lines = evaluated.map(
    (row) =>
      `- ${row.candidate.merchantName} (₹${row.candidate.amount ?? "n/a"}): ${actionLabel(row.recommendedAction)}`
  )
  const base = `No viable seller found for "${query}" — every candidate was refused.\n${lines.join("\n")}\nStatus: no_viable. Do not call payment tools.`
  return budgetNote ? `${base}\n(${budgetNote})` : base
}
