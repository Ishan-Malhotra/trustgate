import { describe, it, expect } from "vitest";
import { applyUserPolicy } from "@/lib/policy/applyUserPolicy";
import { USER_POLICY } from "@/lib/config/userPolicy";
import type { TrustDecision } from "@/lib/types";

const baseDecision: TrustDecision = {
  action: "capture",
  score: 82,
  tier: "high",
  spendLimit: null,
  effectiveAmount: 250,
  trustReason: "High trust",
  breakdown: {
    disputeScore: 40,
    kycBonus: 15,
    ageBonus: 9,
    returnPenalty: 2,
    volatilityPenalty: 1,
    weightedDisputeRate: 0.01,
  },
};

describe("applyUserPolicy", () => {
  it("downgrades capture to hold when over confirm threshold", () => {
    const result = applyUserPolicy(baseDecision, 500, USER_POLICY);
    expect(result.originalAction).toBe("capture");
    expect(result.action).toBe("hold");
    expect(result.policyReason).toContain("300");
  });

  it("refuses when over max spend per transaction", () => {
    const result = applyUserPolicy(baseDecision, 6000, USER_POLICY);
    expect(result.action).toBe("refuse");
  });

  it("keeps capture when within all limits", () => {
    const result = applyUserPolicy(baseDecision, 250, USER_POLICY);
    expect(result.action).toBe("capture");
    expect(result.policyReason).toBeUndefined();
  });
});
