export type CatalogSource = "indiamart"

export interface CatalogCandidate {
  merchantName: string
  amount: number | null
  currency: "INR"
  source: CatalogSource
  sourceUrl: string | null
  city: string | null
  /** Optional passthrough (e.g. gst) — never used for trust decisions. */
  raw?: Record<string, unknown>
}

export interface CatalogProvider {
  readonly id: CatalogSource
  search: (query: string) => Promise<CatalogCandidate[]>
}

export type CatalogSearchStatus =
  | "ok"
  | "no_suppliers"
  | "no_viable"

export interface CatalogEvaluatedCandidate {
  candidate: CatalogCandidate
  amountUsed: number
  sellerId?: string
  recommendedAction: "capture" | "hold" | "refuse"
  effectiveScore?: number
  effectiveTier?: string
  riskScore?: number
  confidenceBand?: string
  trustReason?: string
}

export interface CatalogSearchResult {
  status: CatalogSearchStatus
  query: string
  budget: number
  usedDefaultBudget: boolean
  budgetNote?: string
  candidates: CatalogEvaluatedCandidate[]
  approved: CatalogEvaluatedCandidate[]
  chosen?: CatalogEvaluatedCandidate
  summary: string
}
