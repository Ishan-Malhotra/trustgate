import type { TrustScoreResult, TrustTier } from "@/lib/types";
import type { ConfidenceResult } from "./confidence";
import { isUnverifiedHistoryOnly } from "./trustSignals";

export const LIVE_TRIAL_SPEND_LIMIT = 200;
const MEDIUM_CONFIDENCE_CAP = 800;

function baseSpendLimit(tier: TrustTier, score: number): number | null {
  if (tier === "medium") {
    const mediumBase = 200 + (score - 45) * 15;
    return Math.max(100, Math.min(800, Math.round(mediumBase)));
  }

  if (score >= 85) return null;
  if (score >= 75) return 3000;
  return 1500;
}

function confidenceBackedLowTierLimit(
  score: number,
  band: ConfidenceResult["band"]
): number {
  if (band === "high") {
    const limitScore = Math.max(score, 55);
    return Math.max(
      100,
      Math.min(800, Math.round(200 + (limitScore - 45) * 15))
    );
  }

  return MEDIUM_CONFIDENCE_CAP;
}

/**
 * Returns spend limit in INR (paise handled by callers).
 * null = unlimited, 0 = refuse, else capped amount.
 */
export function getSpendLimit(
  tier: TrustTier,
  score: number,
  confidence?: ConfidenceResult,
  breakdown?: TrustScoreResult["breakdown"]
): number | null {
  if (!confidence) {
    if (tier === "low") return 0;
    return baseSpendLimit(tier, score);
  }

  if (confidence.adverseStatus || confidence.elevatedRisk) return 0;

  if (confidence.band === "low") {
    return LIVE_TRIAL_SPEND_LIMIT;
  }

  if (
    confidence.band === "high" &&
    breakdown &&
    isUnverifiedHistoryOnly(breakdown)
  ) {
    return baseSpendLimit(tier, score);
  }

  if (tier === "low") {
    return confidenceBackedLowTierLimit(score, confidence.band);
  }

  const base = baseSpendLimit(tier, score);

  if (confidence.band === "medium") {
    if (base === null) return MEDIUM_CONFIDENCE_CAP;
    return Math.min(base, MEDIUM_CONFIDENCE_CAP);
  }

  return base;
}
