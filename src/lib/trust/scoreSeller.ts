import type { Seller, TrustScoreResult, TrustTier } from "@/lib/types";

function weightedDisputeRate(history: number[]): number {
  if (history.length === 0) return 0;

  const weights = history.map((_, i) => {
    const position = i / Math.max(history.length - 1, 1);
    return 0.4 + position * 0.6;
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const weightedSum = history.reduce((sum, rate, i) => sum + rate * weights[i], 0);
  return weightedSum / totalWeight;
}

function disputeToScore(rate: number): number {
  const normalized = Math.min(rate / 0.15, 1);
  return Math.round((1 - normalized) * 50);
}

function tierFromScore(score: number): TrustTier {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}

export function scoreSeller(seller: Seller): TrustScoreResult {
  const weightedRate = weightedDisputeRate(seller.dispute_rate_history);
  const disputeScore = disputeToScore(weightedRate);
  const kycBonus = seller.kyc_verified ? 15 : 0;
  const ageBonus = Math.min(Math.floor(seller.account_age_days / 365) * 3, 15);
  const returnPenalty = Math.round(Math.min(seller.return_rate / 0.2, 1) * 20);
  const volatilityPenalty = Math.round(Math.min(seller.price_volatility / 10, 1) * 15);

  const rawScore =
    disputeScore + kycBonus + ageBonus - returnPenalty - volatilityPenalty;
  const score = Math.max(0, Math.min(100, rawScore));

  return {
    score,
    tier: tierFromScore(score),
    breakdown: {
      disputeScore,
      kycBonus,
      ageBonus,
      returnPenalty,
      volatilityPenalty,
      weightedDisputeRate: Math.round(weightedRate * 1000) / 1000,
    },
  };
}
