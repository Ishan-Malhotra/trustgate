import type { TrustScoreResult, TrustTier } from "@/lib/types";
import type { ConfidenceResult } from "./confidence";
import { isUnverifiedHistoryOnly } from "./trustSignals";
import {
  LIVE_TRIAL_SPEND_LIMIT,
  TRUST_SPEND_LIMITS,
} from "./trustSpendLimits";

export {
  LIVE_TRIAL_SPEND_LIMIT,
  TRUST_SPEND_LIMITS,
  type TrustSpendLimits,
} from "./trustSpendLimits";

function baseSpendLimit(tier: TrustTier, score: number): number | null {
  const c = TRUST_SPEND_LIMITS;
  if (tier === "medium") {
    const mediumBase =
      c.mediumBase + (score - c.mediumScoreAnchor) * c.mediumPerScorePoint;
    return Math.max(
      c.mediumFloor,
      Math.min(c.mediumCap, Math.round(mediumBase))
    );
  }

  if (score >= c.unlimitedMinScore) return null;
  if (score >= c.highStrongMinScore) return c.highStrongLimit;
  return c.highBaseLimit;
}

function confidenceBackedLowTierLimit(
  score: number,
  band: ConfidenceResult["band"]
): number {
  const c = TRUST_SPEND_LIMITS;
  if (band === "high") {
    const limitScore = Math.max(score, 55);
    return Math.max(
      c.mediumFloor,
      Math.min(
        c.mediumCap,
        Math.round(
          c.mediumBase +
            (limitScore - c.mediumScoreAnchor) * c.mediumPerScorePoint
        )
      )
    );
  }

  return c.mediumCap;
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
    if (base === null) return TRUST_SPEND_LIMITS.mediumCap;
    return Math.min(base, TRUST_SPEND_LIMITS.mediumCap);
  }

  return base;
}
