import { describe, it, expect } from "vitest";
import { scoreSeller } from "@/lib/trust/scoreSeller";
import { getSpendLimit } from "@/lib/trust/getSpendLimit";
import { getAllSellers } from "@/lib/sellers";
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
});
