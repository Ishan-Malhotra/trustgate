import type { Seller, TrustScoreResult } from "@/lib/types";

export function isUnverifiedHistoryOnly(
  breakdown: TrustScoreResult["breakdown"]
): boolean {
  return (
    !breakdown.transactionHistoryKnown &&
    breakdown.returnPenalty === 0 &&
    breakdown.volatilityPenalty === 0
  );
}

export function hasOnlyMissingHistoryGap(seller: Seller): boolean {
  return (
    seller.dispute_rate_history.length === 0 &&
    seller.return_rate === 0 &&
    seller.price_volatility === 0
  );
}
