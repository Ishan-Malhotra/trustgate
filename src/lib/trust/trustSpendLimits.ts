/**
 * Engine constants for trust-derived spend ceilings.
 * Not user settings — change only in code. Shown read-only in Dev mode.
 */
export const TRUST_SPEND_LIMITS = {
  liveTrialLimit: 200,
  mediumFloor: 100,
  mediumCap: 800,
  mediumBase: 200,
  mediumScoreAnchor: 45,
  mediumPerScorePoint: 15,
  highBaseLimit: 1500,
  highStrongLimit: 3000,
  highStrongMinScore: 75,
  unlimitedMinScore: 85,
} as const;

export type TrustSpendLimits = typeof TRUST_SPEND_LIMITS;

/** Low-confidence trial hold cap (₹) */
export const LIVE_TRIAL_SPEND_LIMIT = TRUST_SPEND_LIMITS.liveTrialLimit;
