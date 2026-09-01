import { describe, it, expect } from "vitest";
import {
  buildLiveLookupReasoningChain,
  formatReasoningChain,
  formatScoreSummary,
} from "@/lib/trust/buildReasoningChain";
import { computeConfidence } from "@/lib/trust/confidence";
import { evaluateTrust } from "@/lib/trust/evaluateTrust";
import { sellerFromMca } from "@/lib/registry/sellerFromMca";
import { applyUserPolicy } from "@/lib/policy/applyUserPolicy";
import { USER_POLICY } from "@/lib/config/userPolicy";
import type { MCARecord } from "@/lib/registry/mcaLookup";

const infosysRecord: MCARecord = {
  cin: "L85110KA1981PLC013115",
  companyName: "INFOSYS LIMITED",
  registrationDate: "1981-07-02",
  status: "Active",
  authorizedCapital: 24_000_000_000,
  paidupCapital: 20_278_293_815,
  state: "karnataka",
  nicCode: "85110",
  rocCode: "ROC Bangalore",
};

describe("buildLiveLookupReasoningChain", () => {
  it("documents MCA → confidence → risk → decision flow", () => {
    const seller = sellerFromMca("Infosys Limited", infosysRecord);
    const confidence = computeConfidence(infosysRecord);
    const trustDecision = evaluateTrust(seller, 250, confidence);
    const finalDecision = applyUserPolicy(trustDecision, 250, USER_POLICY);

    const chain = buildLiveLookupReasoningChain({
      merchantName: "Infosys Limited",
      amount: 250,
      mcaRecord: infosysRecord,
      confidence,
      finalDecision,
    });

    expect(chain).toHaveLength(5);
    expect(chain[0].label).toBe("MCA registry lookup");
    expect(chain[0].detail).toContain("INFOSYS LIMITED");
    expect(chain[2].detail).toContain("Raw signal score");
    expect(chain[2].detail).toContain("Effective score");
    expect(chain[3].detail).toContain("registry");
    expect(formatReasoningChain(chain)).toContain("1. MCA registry lookup:");
  });

  it("formatScoreSummary shows raw and effective when they differ", () => {
    const seller = sellerFromMca("Infosys Limited", infosysRecord);
    const confidence = computeConfidence(infosysRecord);
    const decision = evaluateTrust(seller, 500, confidence);

    const summary = formatScoreSummary(decision);
    expect(summary).toContain("Raw signal score");
    expect(summary).toContain("registry-verified");
    expect(summary).toContain("effective");
    expect(decision.riskScore).toBeLessThan(decision.effectiveScore);
  });
});
