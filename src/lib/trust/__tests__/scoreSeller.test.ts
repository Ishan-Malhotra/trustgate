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
    expect(liveResult.breakdown.noHistoryPenalty).toBe(25);
    expect(liveResult.score).toBe(
      cleanResult.score -
        cleanResult.breakdown.disputeScore +
        liveResult.breakdown.disputeScore -
        liveResult.breakdown.noHistoryPenalty +
        cleanResult.breakdown.returnPenalty +
        cleanResult.breakdown.volatilityPenalty
    );
  });

  it("seed seller scores unchanged after empty-history guard", () => {
    for (const seller of sellers) {
      const result = scoreSeller(seller);
      expect(result.breakdown.transactionHistoryKnown).toBe(true);
      expect(result.breakdown.noHistoryPenalty).toBe(0);
    }
  });

  it("waives noHistoryPenalty for high confidence with history-only gap", () => {
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
    const seller = sellerFromMca("Infosys Limited", infosysRecord);
    const confidence = computeConfidence(infosysRecord);

    const withoutConfidence = scoreSeller(seller);
    const withConfidence = scoreSeller(seller, confidence);

    expect(withoutConfidence.breakdown.noHistoryPenalty).toBe(25);
    expect(withConfidence.breakdown.noHistoryPenalty).toBe(0);
    expect(withConfidence.score).toBeGreaterThan(withoutConfidence.score);
  });

  it("keeps noHistoryPenalty for low confidence with empty history", () => {
    const seller = sellerFromMca("Unknown Corp", null);
    const confidence = computeConfidence(null);
    const result = scoreSeller(seller, confidence);

    expect(confidence.band).toBe("low");
    expect(result.breakdown.noHistoryPenalty).toBe(25);
  });
});

describe("getSpendLimit", () => {
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

  it("uses high-tier limit for high confidence history-only merchants", () => {
    const seller = sellerFromMca("Infosys Limited", infosysRecord);
    const confidence = computeConfidence(infosysRecord);
    const scoreResult = scoreSeller(seller, confidence);
    const decision = evaluateTrust(seller, 500, confidence);

    expect(decision.effectiveTier).toBe("high");
    expect(getSpendLimit(decision.effectiveTier, decision.effectiveScore, confidence, scoreResult.breakdown)).toBe(3000);
    expect(getSpendLimit(decision.effectiveTier, decision.effectiveScore, confidence, scoreResult.breakdown)).toBeGreaterThanOrEqual(1500);
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
    expect(decision.riskScore).toBe(decision.effectiveScore);
  });

  it("high confidence young merchant with low risk score captures, not refuses", () => {
    const seller = sellerFromMca("Young Active Co", {
      cin: "U12345",
      companyName: "YOUNG ACTIVE CO",
      registrationDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      status: "Active",
      authorizedCapital: 1_000_000,
      paidupCapital: 500_000,
      state: "karnataka",
      nicCode: "62010",
      rocCode: "ROC Bangalore",
    });
    const confidence = computeConfidence({
      cin: "U12345",
      companyName: "YOUNG ACTIVE CO",
      registrationDate: seller.account_age_days
        ? new Date(Date.now() - seller.account_age_days * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10)
        : null,
      status: "Active",
      authorizedCapital: 1_000_000,
      paidupCapital: 500_000,
      state: "karnataka",
      nicCode: "62010",
      rocCode: "ROC Bangalore",
    });

    const scoreResult = scoreSeller(seller, confidence);
    expect(scoreResult.tier).toBe("low");
    expect(confidence.band).toBe("medium");

    const decision = evaluateTrust(seller, 250, confidence);
    expect(decision.action).not.toBe("refuse");
    expect(decision.spendLimit).toBeGreaterThan(0);
  });

  it("Infosys ₹500 captures with effective high tier", () => {
    const seller = sellerFromMca("Infosys Limited", infosysRecord);
    const confidence = computeConfidence(infosysRecord);
    const decision = evaluateTrust(seller, 500, confidence);

    expect(confidence.band).toBe("high");
    expect(decision.action).toBe("capture");
    expect(decision.effectiveTier).toBe("high");
    expect(decision.spendLimit).toBeGreaterThanOrEqual(500);
    expect(decision.riskScore).toBeLessThan(decision.effectiveScore);
    expect(decision.riskTier).toBe("medium");
    expect(decision.effectiveScore).toBeGreaterThanOrEqual(75);
  });

  it("high confidence established company captures when history unverified", () => {
    const seller = sellerFromMca("Infosys Limited", infosysRecord);
    const confidence = computeConfidence(infosysRecord);
    const decision = evaluateTrust(seller, 250, confidence);

    expect(confidence.band).toBe("high");
    expect(decision.action).toBe("capture");
    expect(decision.effectiveTier).toBe("high");
    expect(decision.trustReason).toContain("High registry confidence");
    expect(decision.spendLimit).toBeGreaterThan(250);
    expect(decision.riskScore).toBeLessThan(decision.effectiveScore);
  });

  it("verified merchant with bad transaction signals does not get registry floor", () => {
    const seller: Seller = {
      ...sellerFromMca("Bad Verified Co", infosysRecord),
      dispute_rate_history: [0.02, 0.05, 0.18, 0.22],
      return_rate: 0.15,
      price_volatility: 8,
    };
    const confidence = computeConfidence(infosysRecord);
    const decision = evaluateTrust(seller, 250, confidence);

    expect(confidence.band).toBe("high");
    expect(decision.riskScore).toBe(decision.effectiveScore);
    expect(decision.effectiveTier).not.toBe("high");
    expect(["refuse", "hold"]).toContain(decision.action);
  });

  it("gaming seller unchanged without confidence", () => {
    const gaming = getAllSellers().find((s) => s.id === "seller-gaming")!;
    const decision = evaluateTrust(gaming, 100);
    expect(["refuse", "hold"]).toContain(decision.action);
    expect(decision.riskScore).toBe(decision.effectiveScore);
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
    expect(decision.riskScore).toBe(decision.effectiveScore);
    expect(decision.riskTier).toBe(decision.effectiveTier);
  });
});
