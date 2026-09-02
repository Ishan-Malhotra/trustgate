import { describe, it, expect } from "vitest"
import { buildTrustDisplayLines } from "@/lib/ui/trustDisplay"
import type { SellerTrustCheck } from "@/lib/types"

function makeCheck(
  overrides: Partial<SellerTrustCheck> = {}
): SellerTrustCheck {
  return {
    sellerId: "live:unknown:test",
    sellerName: "Test Co",
    amount: 250,
    score: 0,
    tier: "low",
    riskScore: 0,
    riskTier: "low",
    effectiveScore: 0,
    effectiveTier: "low",
    spendLimit: 200,
    recommendedAction: "hold",
    trustReason: "Insufficient verifiable history — trial spend capped at ₹200",
    liveLookup: true,
    confidenceLevel: 15,
    confidenceBand: "low",
    confidenceReasons: [
      "Not found in MCA Company Master Data — insufficient verifiable history",
    ],
    ...overrides,
  }
}

describe("buildTrustDisplayLines", () => {
  it("shows confidence separately for low-confidence live lookup", () => {
    const lines = buildTrustDisplayLines(makeCheck())
    expect(lines.find((l) => l.label === "Confidence")?.value).toBe("Low (15%)")
    expect(lines.find((l) => l.label === "Risk signals")?.value).toMatch(
      /Unknown.*not scored as bad/i
    )
    expect(lines.some((l) => l.label === "Trust" && l.value.includes("0"))).toBe(
      false
    )
  })

  it("shows dual risk/effective when registry floor applies", () => {
    const lines = buildTrustDisplayLines(
      makeCheck({
        riskScore: 40,
        riskTier: "low",
        score: 75,
        tier: "high",
        effectiveScore: 75,
        effectiveTier: "high",
        confidenceLevel: 85,
        confidenceBand: "high",
        recommendedAction: "capture",
      })
    )
    expect(lines.find((l) => l.label === "Confidence")?.value).toBe("High (85%)")
    expect(lines.find((l) => l.label === "Risk signals")?.value).toBe("40 (low)")
    expect(lines.find((l) => l.label === "Effective trust")?.value).toBe(
      "75 (high)"
    )
  })

  it("keeps seed-catalog trust display unchanged", () => {
    const lines = buildTrustDisplayLines(
      makeCheck({
        liveLookup: false,
        confidenceBand: undefined,
        confidenceLevel: undefined,
        score: 82,
        tier: "high",
        riskScore: 82,
        riskTier: "high",
        effectiveScore: 82,
        effectiveTier: "high",
      })
    )
    expect(lines).toEqual([
      expect.objectContaining({ label: "Trust", value: "82 (high)" }),
    ])
  })
})
