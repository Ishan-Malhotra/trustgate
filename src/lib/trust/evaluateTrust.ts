import type { Seller, TrustDecision, TrustScoreResult, TrustTier } from "@/lib/types";
import type { ConfidenceResult } from "./confidence";
import { getSpendLimit, LIVE_TRIAL_SPEND_LIMIT } from "./getSpendLimit";
import { scoreSeller } from "./scoreSeller";

export function isUnverifiedHistoryOnly(
  breakdown: TrustScoreResult["breakdown"]
): boolean {
  return (
    !breakdown.transactionHistoryKnown &&
    breakdown.returnPenalty === 0 &&
    breakdown.volatilityPenalty === 0
  );
}

function applyConfidenceRiskOverrides(
  scoreResult: ReturnType<typeof scoreSeller>,
  confidence: ConfidenceResult
): { score: number; tier: TrustTier; breakdown: typeof scoreResult.breakdown } {
  if (confidence.adverseStatus || confidence.elevatedRisk) {
    return {
      score: confidence.adverseStatus ? 0 : Math.min(scoreResult.score, 40),
      tier: "low",
      breakdown: scoreResult.breakdown,
    };
  }

  return {
    score: scoreResult.score,
    tier: scoreResult.tier,
    breakdown: scoreResult.breakdown,
  };
}

export function evaluateTrust(
  seller: Seller,
  amount: number,
  confidence?: ConfidenceResult
): TrustDecision {
  const scoreResult = scoreSeller(seller);
  let { score, tier, breakdown } = scoreResult;

  if (confidence) {
    const overridden = applyConfidenceRiskOverrides(scoreResult, confidence);
    score = overridden.score;
    tier = overridden.tier;
    breakdown = overridden.breakdown;
  }

  const spendLimit = getSpendLimit(tier, score, confidence);

  const confidenceFields = confidence
    ? {
        confidenceLevel: confidence.level,
        confidenceBand: confidence.band,
        confidenceReasons: confidence.reasons,
      }
    : {};

  if (confidence?.adverseStatus || confidence?.elevatedRisk) {
    return {
      action: "refuse",
      score,
      tier,
      spendLimit: 0,
      effectiveAmount: amount,
      trustReason: confidence.adverseStatus
        ? `Adverse MCA registry status — seller refused`
        : `Elevated registry risk (${confidence.reasons[0]}) — seller refused`,
      breakdown,
      ...confidenceFields,
    };
  }

  if (confidence?.band === "low") {
    const trialAmount = Math.min(amount, LIVE_TRIAL_SPEND_LIMIT);
    return {
      action: "hold",
      score,
      tier,
      spendLimit: LIVE_TRIAL_SPEND_LIMIT,
      effectiveAmount: trialAmount,
      trustReason: `Insufficient verifiable history — trial spend capped at ₹${LIVE_TRIAL_SPEND_LIMIT}`,
      breakdown,
      ...confidenceFields,
    };
  }

  if (spendLimit === 0) {
    return {
      action: "refuse",
      score,
      tier,
      spendLimit,
      effectiveAmount: amount,
      trustReason: `Low trust (score ${score}) — seller refused`,
      breakdown,
      ...confidenceFields,
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
      ...confidenceFields,
    };
  }

  const registryVerified =
    confidence?.band === "high" && isUnverifiedHistoryOnly(breakdown);

  if (registryVerified) {
    return {
      action: "capture",
      score,
      tier,
      spendLimit,
      effectiveAmount: amount,
      trustReason: `High registry confidence (${confidence.level}%) — approved; no bad transaction signals, only unverified purchase history`,
      breakdown,
      ...confidenceFields,
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
      ...confidenceFields,
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
    ...confidenceFields,
  };
}
