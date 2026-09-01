export interface SellerListing {
  item: string;
  price: number;
}

export interface Seller {
  id: string;
  name: string;
  category: string;
  account_age_days: number;
  kyc_verified: boolean;
  dispute_rate_history: number[];
  return_rate: number;
  price_volatility: number;
  _comment?: string;
  known_for?: string[];
  listings?: SellerListing[];
}

export type TrustTier = "high" | "medium" | "low";

export type PaymentAction = "capture" | "hold" | "refuse";

export interface TrustScoreResult {
  score: number;
  tier: TrustTier;
  breakdown: {
    disputeScore: number;
    kycBonus: number;
    ageBonus: number;
    returnPenalty: number;
    volatilityPenalty: number;
    weightedDisputeRate: number;
    transactionHistoryKnown: boolean;
    noHistoryPenalty: number;
  };
}

export interface UserPolicy {
  max_spend_per_transaction: number;
  max_spend_per_seller: number;
  confirm_above_amount: number;
  hold_expiry_seconds: number;
}

export interface TrustDecision {
  action: PaymentAction;
  /** Alias for effectiveScore — used by decisions and spend limits */
  score: number;
  /** Alias for effectiveTier — used by decisions and spend limits */
  tier: TrustTier;
  riskScore: number;
  riskTier: TrustTier;
  effectiveScore: number;
  effectiveTier: TrustTier;
  spendLimit: number | null;
  effectiveAmount: number;
  trustReason: string;
  breakdown: TrustScoreResult["breakdown"];
  confidenceLevel?: number;
  confidenceBand?: "high" | "medium" | "low";
  confidenceReasons?: string[];
}

export interface FinalDecision extends TrustDecision {
  policyReason?: string;
  originalAction: PaymentAction;
}

export interface SellerTrustCheck {
  sellerId: string;
  sellerName: string;
  amount: number;
  /** Alias for effectiveScore */
  score: number;
  /** Alias for effectiveTier */
  tier: TrustTier;
  riskScore: number;
  riskTier: TrustTier;
  effectiveScore: number;
  effectiveTier: TrustTier;
  spendLimit: number | null;
  recommendedAction: PaymentAction;
  trustReason: string;
  policyReason?: string;
  confidenceLevel?: number;
  confidenceBand?: "high" | "medium" | "low";
  confidenceReasons?: string[];
  liveLookup?: boolean;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  type:
    | "trust_check"
    | "policy_check"
    | "payment"
    | "refusal"
    | "error"
    | "agent"
    | "reasoning"
    | "flagged";
  message: string;
  details?: Record<string, unknown>;
}
