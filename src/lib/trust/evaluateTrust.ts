import type { Seller, TrustDecision, TrustScoreResult, TrustTier } from "@/lib/types";
import type { ConfidenceResult } from "./confidence";
import { getSpendLimit, LIVE_TRIAL_SPEND_LIMIT } from "./getSpendLimit";
import { scoreSeller, tierFromScore } from "./scoreSeller";
import { isUnverifiedHistoryOnly } from "./trustSignals";

export { isUnverifiedHistoryOnly } from "./trustSignals";

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

function applyRegistryFloor(
  score: number,
  tier: TrustTier,
  confidence: ConfidenceResult | undefined,
  breakdown: TrustScoreResult["breakdown"]
): { score: number; tier: TrustTier } {
  if (confidence?.band === "high" && isUnverifiedHistoryOnly(breakdown)) {
    const floorScore = confidence.level >= 80 ? 75 : 55;
    const floored = Math.max(score, floorScore);
    return { score: floored, tier: tierFromScore(floored) };
  }
  return { score, tier };
}

function buildScoreFields(
  riskScore: number,
  riskTier: TrustTier,
  effectiveScore: number,
  effectiveTier: TrustTier
) {
  return {
    riskScore,
    riskTier,
    effectiveScore,
    effectiveTier,
    score: effectiveScore,
    tier: effectiveTier,
  };
}

function buildDecision(
  base: Omit<
    TrustDecision,
    "riskScore" | "riskTier" | "effectiveScore" | "effectiveTier" | "score" | "tier"
  >,
  riskScore: number,
  riskTier: TrustTier,
  effectiveScore: number,
  effectiveTier: TrustTier
): TrustDecision {
  return {
    ...base,
    ...buildScoreFields(riskScore, riskTier, effectiveScore, effectiveTier),
  };
}

export function evaluateTrust(
  seller: Seller,
  amount: number,
  confidence?: ConfidenceResult
): TrustDecision {
  const scoreResult = scoreSeller(seller, confidence);
  let { score, tier, breakdown } = scoreResult;

  if (confidence) {
    const overridden = applyConfidenceRiskOverrides(scoreResult, confidence);
    score = overridden.score;
    tier = overridden.tier;
    breakdown = overridden.breakdown;
  }

  const riskScore = score;
  const riskTier = tier;

  const floored = applyRegistryFloor(score, tier, confidence, breakdown);
  score = floored.score;
  tier = floored.tier;

  const effectiveScore = score;
  const effectiveTier = tier;

  const spendLimit = getSpendLimit(tier, score, confidence, breakdown);

  const confidenceFields = confidence
    ? {
        confidenceLevel: confidence.level,
        confidenceBand: confidence.band,
        confidenceReasons: confidence.reasons,
      }
    : {};

  if (confidence?.adverseStatus || confidence?.elevatedRisk) {
    return buildDecision(
      {
        action: "refuse",
        spendLimit: 0,
        effectiveAmount: amount,
        trustReason: confidence.adverseStatus
          ? `Adverse MCA registry status — seller refused`
          : `Elevated registry risk (${confidence.reasons[0]}) — seller refused`,
        breakdown,
        ...confidenceFields,
      },
      riskScore,
      riskTier,
      effectiveScore,
      effectiveTier
    );
  }

  if (confidence?.band === "low") {
    const trialAmount = Math.min(amount, LIVE_TRIAL_SPEND_LIMIT);
    return buildDecision(
      {
        action: "hold",
        spendLimit: LIVE_TRIAL_SPEND_LIMIT,
        effectiveAmount: trialAmount,
        trustReason: `Insufficient verifiable history — trial spend capped at ₹${LIVE_TRIAL_SPEND_LIMIT}`,
        breakdown,
        ...confidenceFields,
      },
      riskScore,
      riskTier,
      effectiveScore,
      effectiveTier
    );
  }

  if (spendLimit === 0) {
    return buildDecision(
      {
        action: "refuse",
        spendLimit,
        effectiveAmount: amount,
        trustReason: `Low trust (score ${effectiveScore}) — seller refused`,
        breakdown,
        ...confidenceFields,
      },
      riskScore,
      riskTier,
      effectiveScore,
      effectiveTier
    );
  }

  if (spendLimit !== null && amount > spendLimit) {
    return buildDecision(
      {
        action: "hold",
        spendLimit,
        effectiveAmount: spendLimit,
        trustReason: `Amount ₹${amount} exceeds trust spend limit ₹${spendLimit} for ${effectiveTier} tier`,
        breakdown,
        ...confidenceFields,
      },
      riskScore,
      riskTier,
      effectiveScore,
      effectiveTier
    );
  }

  const registryVerified =
    confidence?.band === "high" && isUnverifiedHistoryOnly(breakdown);

  if (
    effectiveTier === "low" &&
    confidence?.band === "high" &&
    !registryVerified
  ) {
    return buildDecision(
      {
        action: "refuse",
        spendLimit: spendLimit === null ? 0 : spendLimit,
        effectiveAmount: amount,
        trustReason: `Low trust (score ${effectiveScore}) despite registry verification — adverse transaction signals present`,
        breakdown,
        ...confidenceFields,
      },
      riskScore,
      riskTier,
      effectiveScore,
      effectiveTier
    );
  }

  if (registryVerified) {
    const floorNote =
      riskScore !== effectiveScore
        ? ` Raw signal score ${riskScore} (${riskTier}) — registry-verified, effective ${effectiveScore} (${effectiveTier}).`
        : "";
    return buildDecision(
      {
        action: "capture",
        spendLimit,
        effectiveAmount: amount,
        trustReason: `High registry confidence (${confidence.level}%) — approved; no bad transaction signals, only unverified purchase history.${floorNote}`,
        breakdown,
        ...confidenceFields,
      },
      riskScore,
      riskTier,
      effectiveScore,
      effectiveTier
    );
  }

  if (effectiveTier === "low") {
    const capped =
      spendLimit !== null ? Math.min(amount, spendLimit) : amount;
    return buildDecision(
      {
        action: "hold",
        spendLimit,
        effectiveAmount: capped,
        trustReason: `Low trust (score ${effectiveScore}) — authorization held; not eligible for automatic capture`,
        breakdown,
        ...confidenceFields,
      },
      riskScore,
      riskTier,
      effectiveScore,
      effectiveTier
    );
  }

  if (effectiveTier === "medium") {
    return buildDecision(
      {
        action: "hold",
        spendLimit,
        effectiveAmount: amount,
        trustReason: `Medium trust (score ${effectiveScore}) — authorization held for review`,
        breakdown,
        ...confidenceFields,
      },
      riskScore,
      riskTier,
      effectiveScore,
      effectiveTier
    );
  }

  return buildDecision(
    {
      action: "capture",
      spendLimit,
      effectiveAmount: amount,
      trustReason: `High trust (score ${effectiveScore}) — approved for capture`,
      breakdown,
      ...confidenceFields,
    },
    riskScore,
    riskTier,
    effectiveScore,
    effectiveTier
  );
}
