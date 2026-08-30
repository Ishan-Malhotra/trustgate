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
  score: number;
  tier: TrustTier;
  spendLimit: number | null;
  effectiveAmount: number;
  trustReason: string;
  breakdown: TrustScoreResult["breakdown"];
}

export interface FinalDecision extends TrustDecision {
  policyReason?: string;
  originalAction: PaymentAction;
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
    | "flagged";
  message: string;
  details?: Record<string, unknown>;
}
