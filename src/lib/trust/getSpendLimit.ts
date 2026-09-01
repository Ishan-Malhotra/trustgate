import type { TrustTier } from "@/lib/types";
import type { ConfidenceResult } from "./confidence";

export const LIVE_TRIAL_SPEND_LIMIT = 200;
const MEDIUM_CONFIDENCE_CAP = 800;

/**
 * Returns spend limit in INR (paise handled by callers).
 * null = unlimited, 0 = refuse, else capped amount.
 */
export function getSpendLimit(
  tier: TrustTier,
  score: number,
  confidence?: ConfidenceResult
): number | null {
  if (tier === "low") return 0;

  let base: number | null;
  if (tier === "medium") {
    const mediumBase = 200 + (score - 45) * 15;
    base = Math.max(100, Math.min(800, Math.round(mediumBase)));
  } else if (score >= 85) {
    base = null;
  } else if (score >= 75) {
    base = 3000;
  } else {
    base = 1500;
  }

  if (!confidence) return base;

  if (confidence.adverseStatus) return 0;

  if (confidence.band === "low") {
    return LIVE_TRIAL_SPEND_LIMIT;
  }

  if (confidence.band === "medium") {
    if (base === null) return MEDIUM_CONFIDENCE_CAP;
    return Math.min(base, MEDIUM_CONFIDENCE_CAP);
  }

  return base;
}
