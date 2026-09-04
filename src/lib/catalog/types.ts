export type CatalogSource = "indiamart"

export interface CatalogCandidate {
  merchantName: string
  amount: number | null
  currency: "INR"
  source: CatalogSource
  sourceUrl: string | null
  city: string | null
  /** Listing title when present — TrustGate product integrity uses this as an untrusted claim. */
  productName: string | null
  /** GSTIN when present on listing — TrustGate may verify; shopping does not decide trust. */
  gstin: string | null
  /** Optional passthrough extras — not used for trust decisions by shopping agent. */
  raw?: Record<string, unknown>
}

export interface CatalogProvider {
  readonly id: CatalogSource
  search: (query: string) => Promise<CatalogCandidate[]>
}

/** Final shopping-layer status after capture-first ranking. */
export type CatalogSearchStatus =
  | "authorized"
  | "requires_confirmation"
  | "no_viable"
  | "no_suppliers"

export interface ProductIntegrityResult {
  match: boolean
  requested: string
  found: string
  reason: string
}

export interface PriceIntegrityResult {
  quotedPrice: number
  referenceRange?: { min: number; max: number }
  anomaly: "none" | "moderate" | "extreme"
  reason: string
}

export type ShoppingReliabilityLevel = "none" | "caution" | "unreliable"

export type ShoppingReliabilityTrigger =
  | "product_mismatch"
  | "extreme_price"
  | "seller_refuse_streak"

export interface ShoppingReliabilityWarning {
  level: ShoppingReliabilityLevel
  badProposalCount: number
  totalProposals: number
  failureRate: number
  message: string
  triggers: ShoppingReliabilityTrigger[]
  details: string[]
}

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
  productIntegrity?: ProductIntegrityResult
  priceIntegrity?: PriceIntegrityResult
}

/**
 * Raw TrustGate evaluations from catalog infrastructure.
 * ShoppingAgent applies capture-first ranking on top of this.
 */
export interface CatalogEvaluationResult {
  query: string
  budget: number
  usedDefaultBudget: boolean
  budgetNote?: string
  candidates: CatalogEvaluatedCandidate[]
  /** True when IndiaMART returned no mappable suppliers. */
  noSuppliers: boolean
  summary?: string
  shoppingReliability?: ShoppingReliabilityWarning
}

export interface CatalogSearchResult {
  status: CatalogSearchStatus
  query: string
  budget: number
  usedDefaultBudget: boolean
  budgetNote?: string
  candidates: CatalogEvaluatedCandidate[]
  /** CAPTURE only — eligible for automatic purchase. */
  approved: CatalogEvaluatedCandidate[]
  /** HOLD only — bounded authorization / requires confirmation. */
  holds: CatalogEvaluatedCandidate[]
  chosen?: CatalogEvaluatedCandidate
  summary: string
  /** Short reason for the shopping decision (same intent as summary, for callers). */
  reason: string
  shoppingReliability?: ShoppingReliabilityWarning
}
