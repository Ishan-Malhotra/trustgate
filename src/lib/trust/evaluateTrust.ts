import type { Seller, TrustDecision } from "@/lib/types";
import { getSpendLimit } from "./getSpendLimit";
import { scoreSeller } from "./scoreSeller";

export function evaluateTrust(seller: Seller, amount: number): TrustDecision {
  const { score, tier, breakdown } = scoreSeller(seller);
  const spendLimit = getSpendLimit(tier, score);

  if (spendLimit === 0) {
    return {
      action: "refuse",
      score,
      tier,
      spendLimit,
      effectiveAmount: amount,
      trustReason: `Low trust (score ${score}) — seller refused`,
      breakdown,
    };
  }

  if (spendLimit !== null && amount > spendLimit) {
    return {
      action: "hold",
      score,
      tier,
      spendLimit,
      effectiveAmount: spendLimit,
      trustReason: `Amount ₹${amount} exceeds trust spend limit ₹${spendLimit} for ${tier} tier`,
      breakdown,
    };
  }

  if (tier === "medium") {
    return {
      action: "hold",
      score,
      tier,
      spendLimit,
      effectiveAmount: amount,
      trustReason: `Medium trust (score ${score}) — authorization held for review`,
      breakdown,
    };
  }

  return {
    action: "capture",
    score,
    tier,
    spendLimit,
    effectiveAmount: amount,
    trustReason: `High trust (score ${score}) — approved for capture`,
    breakdown,
  };
}
