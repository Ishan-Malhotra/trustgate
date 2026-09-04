import { describe, it, expect } from "vitest"
import { assessShoppingReliability } from "@/lib/trustgate/shoppingReliability"
import type { CatalogEvaluatedCandidate } from "@/lib/catalog/types"

function row(
  match: boolean,
  anomaly: "none" | "moderate" | "extreme" = "none"
): CatalogEvaluatedCandidate {
  return {
    candidate: {
      merchantName: "X",
      amount: 100,
      currency: "INR",
      source: "indiamart",
      sourceUrl: null,
      city: null,
      productName: "Thing",
      gstin: null,
    },
    amountUsed: 100,
    recommendedAction: match && anomaly !== "extreme" ? "capture" : "refuse",
    productIntegrity: {
      match,
      requested: "Thing",
      found: "Thing",
      reason: match ? "ok" : "mismatch",
    },
    priceIntegrity: {
      quotedPrice: 100,
      anomaly,
      reason: anomaly,
    },
  }
}

describe("assessShoppingReliability", () => {
  it("caution for a single integrity failure in a larger batch", () => {
    const result = assessShoppingReliability([row(false), row(true), row(true)])
    expect(result.level).toBe("caution")
    expect(result.message).toMatch(/intervening/i)
  })

  it("unreliable when majority fail", () => {
    const result = assessShoppingReliability([
      row(false),
      row(false),
      row(true),
    ])
    expect(result.level).toBe("unreliable")
  })
})
