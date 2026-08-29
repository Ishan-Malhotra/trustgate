import type { TrustTier } from "@/lib/types";

/**
 * Returns spend limit in INR (paise handled by callers).
 * null = unlimited, 0 = refuse, else capped amount.
 */
export function getSpendLimit(tier: TrustTier, score: number): number | null {
  if (tier === "low") return 0;

  if (tier === "medium") {
    const base = 200 + (score - 45) * 15;
    return Math.max(100, Math.min(800, Math.round(base)));
  }

  // high tier
  if (score >= 85) return null;
  if (score >= 75) return 3000;
  return 1500;
}
