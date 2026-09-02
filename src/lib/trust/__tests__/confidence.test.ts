import { describe, it, expect } from "vitest";
import { computeConfidence } from "@/lib/trust/confidence";
import type { MCARecord } from "@/lib/registry/mcaLookup";

const establishedActive: MCARecord = {
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

const youngActive: MCARecord = {
  cin: "ABD-0345",
  companyName: "Titan Winners Fund Management LLP",
  registrationDate: "2023-02-10",
  status: "Active",
  authorizedCapital: 0,
  paidupCapital: 0,
  state: "haryana",
  nicCode: "",
  rocCode: "ROC Haryana",
};

describe("computeConfidence", () => {
  it("returns low confidence when not found", () => {
    const result = computeConfidence(null);
    expect(result.band).toBe("low");
    expect(result.level).toBeLessThan(30);
    expect(result.reasons[0]).toContain("insufficient verifiable history");
    expect(result.adverseStatus).toBe(false);
    expect(result.elevatedRisk).toBe(false);
  });

  it("returns high confidence for established active company", () => {
    const result = computeConfidence(establishedActive);
    expect(result.band).toBe("high");
    expect(result.level).toBeGreaterThanOrEqual(80);
    expect(result.adverseStatus).toBe(false);
  });

  it("returns medium confidence for young active company", () => {
    const result = computeConfidence(youngActive);
    expect(result.band).toBe("medium");
    expect(
      result.reasons.some(
        (r) =>
          r.includes("Recently registered") || r.includes("Thin paid-up capital")
      )
    ).toBe(true);
  });

  it("flags struck-off as adverse and elevated risk", () => {
    const result = computeConfidence({
      ...establishedActive,
      status: "Struck Off",
    });
    expect(result.band).toBe("low");
    expect(result.adverseStatus).toBe(true);
    expect(result.elevatedRisk).toBe(true);
    expect(result.reasons[0]).toContain("Struck Off");
  });

  it("flags dormant as elevated risk", () => {
    const result = computeConfidence({
      ...establishedActive,
      status: "Dormant",
    });
    expect(result.elevatedRisk).toBe(true);
    expect(result.adverseStatus).toBe(false);
  });
});
