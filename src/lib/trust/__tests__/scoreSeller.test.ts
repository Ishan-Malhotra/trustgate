import { describe, it, expect } from "vitest";
import { scoreSeller } from "@/lib/trust/scoreSeller";
import { getSpendLimit, LIVE_TRIAL_SPEND_LIMIT } from "@/lib/trust/getSpendLimit";
import { evaluateTrust } from "@/lib/trust/evaluateTrust";
import { getAllSellers } from "@/lib/sellers";
import { sellerFromMca } from "@/lib/registry/sellerFromMca";
import { computeConfidence } from "@/lib/trust/confidence";
import type { MCARecord } from "@/lib/registry/mcaLookup";
import type { Seller } from "@/lib/types";

describe("scoreSeller", () => {
  const sellers = getAllSellers();

  it("scores high-trust sellers above 75", () => {
    const blueBottle = sellers.find((s) => s.id === "seller-002")!;
    const result = scoreSeller(blueBottle);
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.tier).toBe("high");
  });

  it("scores low-trust sellers below 45", () => {
    const bargain = sellers.find((s) => s.id === "seller-004")!;
    const result = scoreSeller(bargain);
    expect(result.score).toBeLessThan(45);
    expect(result.tier).toBe("low");
  });

  it("detects gaming seller via recent dispute spike", () => {
    const gaming = sellers.find((s) => s.id === "seller-gaming")!;
    const clean = sellers.find((s) => s.id === "seller-001")!;
    const gamingResult = scoreSeller(gaming);
    const cleanResult = scoreSeller(clean);

    expect(gamingResult.breakdown.weightedDisputeRate).toBeGreaterThan(0.1);
    expect(gamingResult.score).toBeLessThan(cleanResult.score);
    expect(["medium", "low"]).toContain(gamingResult.tier);
  });

  it("is deterministic", () => {
    const seller = sellers[0];
    expect(scoreSeller(seller)).toEqual(scoreSeller(seller));
  });

  it("empty dispute history scores no better than populated clean history", () => {
    const cleanSeed = sellers.find((s) => s.id === "seller-002")!;
    const liveUnknown: Seller = {
      ...cleanSeed,
      id: "live:test",
      dispute_rate_history: [],
      return_rate: 0,
      price_volatility: 0,
    };

    const cleanResult = scoreSeller(cleanSeed);
    const liveResult = scoreSeller(liveUnknown);

    expect(liveResult.score).toBeLessThanOrEqual(cleanResult.score);
    expect(liveResult.breakdown.transactionHistoryKnown).toBe(false);
    expect(liveResult.breakdown.disputeScore).toBeLessThan(
      cleanResult.breakdown.disputeScore
    );
  });

  it("seed seller scores unchanged after empty-history guard", () => {
    for (const seller of sellers) {
      const result = scoreSeller(seller);
      expect(result.breakdown.transactionHistoryKnown).toBe(true);
      expect(result.breakdown.noHistoryPenalty).toBe(0);
    }
  });
});

describe("getSpendLimit", () => {
  it("refuses low tier", () => {
    expect(getSpendLimit("low", 30)).toBe(0);
  });

  it("caps medium tier", () => {
    const limit = getSpendLimit("medium", 60);
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(800);
  });

  it("allows unlimited for high tier with strong score", () => {
    expect(getSpendLimit("high", 90)).toBeNull();
  });

  it("returns trial cap for low confidence", () => {
    const confidence = computeConfidence(null);
    expect(getSpendLimit("high", 80, confidence)).toBe(LIVE_TRIAL_SPEND_LIMIT);
  });

  it("omitted confidence preserves seed behavior", () => {
    expect(getSpendLimit("high", 90)).toBeNull();
    expect(getSpendLimit("medium", 60)).toBe(425);
  });
});

describe("evaluateTrust with confidence", () => {
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

  it("low confidence not-found yields trial hold, not refuse", () => {
    const seller = sellerFromMca("Unknown Corp XYZ", null);
    const confidence = computeConfidence(null);
    const decision = evaluateTrust(seller, 500, confidence);

    expect(decision.action).toBe("hold");
    expect(decision.spendLimit).toBe(LIVE_TRIAL_SPEND_LIMIT);
    expect(decision.trustReason).toContain("Insufficient verifiable history");
    expect(decision.confidenceBand).toBe("low");
  });

  it("high confidence established company captures when history unverified", () => {
    const seller = sellerFromMca("Infosys Limited", infosysRecord);
    const confidence = computeConfidence(infosysRecord);
    const decision = evaluateTrust(seller, 250, confidence);

    expect(confidence.band).toBe("high");
    expect(decision.action).toBe("capture");
    expect(decision.tier).toBe("medium");
    expect(decision.trustReason).toContain("High registry confidence");
    expect(decision.spendLimit).toBeGreaterThan(250);
  });

  it("adverse MCA status refuses", () => {
    const struckOff: MCARecord = {
      ...infosysRecord,
      status: "Struck Off",
    };
    const seller = sellerFromMca("Bad Co", struckOff);
    const confidence = computeConfidence(struckOff);
    const decision = evaluateTrust(seller, 100, confidence);

    expect(decision.action).toBe("refuse");
    expect(confidence.adverseStatus).toBe(true);
  });

  it("seed path unchanged without confidence", () => {
    const seller = getAllSellers().find((s) => s.id === "seller-002")!;
    const decision = evaluateTrust(seller, 200);
    expect(decision.action).toBe("capture");
    expect(decision.confidenceBand).toBeUndefined();
  });
});
