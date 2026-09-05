import { describe, it, expect } from "vitest"
import { assertPaymentAuthorized } from "@/lib/agent/assertPaymentAuthorized"
import type { FinalDecision } from "@/lib/types"

function decision(
  action: FinalDecision["action"],
  extras?: Partial<FinalDecision>
): FinalDecision {
  return {
    originalAction: action,
    score: 80,
    tier: "high",
    riskScore: 80,
    riskTier: "high",
    effectiveScore: 80,
    effectiveTier: "high",
    spendLimit: extras?.spendLimit ?? null,
    effectiveAmount: extras?.effectiveAmount ?? 150,
    trustReason: "ok",
    breakdown: {
      disputeScore: 80,
      kycBonus: 0,
      ageBonus: 0,
      returnPenalty: 0,
      volatilityPenalty: 0,
      weightedDisputeRate: 0,
      transactionHistoryKnown: true,
      noHistoryPenalty: 0,
    },
    ...extras,
    action,
  }
}

describe("assertPaymentAuthorized", () => {
  it("blocks capture when stored decision is hold", () => {
    const result = assertPaymentAuthorized({
      sellerId: "live:hold",
      amount: 67,
      action: "capture",
      decision: decision("hold", { effectiveAmount: 67 }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/expected hold, got capture/)
    }
  })

  it("allows hold when stored decision is hold (seed / live lookup path)", () => {
    const result = assertPaymentAuthorized({
      sellerId: "seller-001",
      amount: 450,
      action: "hold",
      decision: decision("hold", { effectiveAmount: 450 }),
    })
    expect(result).toEqual({ ok: true, payAmount: 450 })
  })

  it("uses TrustGate effectiveAmount when shopping status is unset", () => {
    const result = assertPaymentAuthorized({
      sellerId: "seller-001",
      amount: 150,
      action: "capture",
      decision: decision("capture", { effectiveAmount: 150 }),
    })
    expect(result).toEqual({ ok: true, payAmount: 150 })
  })

  it("blocks all payment when catalog requires_confirmation", () => {
    const result = assertPaymentAuthorized({
      sellerId: "live:conifer",
      amount: 67,
      action: "hold",
      decision: decision("hold", { effectiveAmount: 67 }),
      shoppingStatus: "requires_confirmation",
      shoppingChosenSellerId: "live:conifer",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/requires_confirmation/)
    }
  })

  it("blocks capture on requires_confirmation even if the model asks for capture", () => {
    const result = assertPaymentAuthorized({
      sellerId: "live:conifer",
      amount: 67,
      action: "capture",
      decision: decision("hold", { effectiveAmount: 67 }),
      shoppingStatus: "requires_confirmation",
      shoppingChosenSellerId: "live:conifer",
    })
    expect(result.ok).toBe(false)
  })

  it("does not fall back to another seller's decision", () => {
    const result = assertPaymentAuthorized({
      sellerId: "live:missing",
      amount: 100,
      action: "capture",
      decision: undefined,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/this seller/)
    }
  })

  it("catalog authorized pays only the chosen CAPTURE seller", () => {
    const ok = assertPaymentAuthorized({
      sellerId: "live:chosen",
      amount: 95,
      action: "capture",
      decision: decision("capture", { effectiveAmount: 95 }),
      shoppingStatus: "authorized",
      shoppingChosenSellerId: "live:chosen",
    })
    expect(ok).toEqual({ ok: true, payAmount: 95 })

    const wrongSeller = assertPaymentAuthorized({
      sellerId: "live:other",
      amount: 120,
      action: "capture",
      decision: decision("capture", { effectiveAmount: 120 }),
      shoppingStatus: "authorized",
      shoppingChosenSellerId: "live:chosen",
      shoppingCatalogSellerIds: ["live:chosen", "live:other"],
    })
    expect(wrongSeller.ok).toBe(false)
    if (!wrongSeller.ok) {
      expect(wrongSeller.error).toMatch(/different seller/)
    }
  })

  it("does not lock seed-seller payment after catalog authorized another merchant", () => {
    const result = assertPaymentAuthorized({
      sellerId: "seller-001",
      amount: 150,
      action: "capture",
      decision: decision("capture", { effectiveAmount: 150 }),
      shoppingStatus: "authorized",
      shoppingChosenSellerId: "live:chosen",
      shoppingCatalogSellerIds: ["live:chosen", "live:other"],
    })
    expect(result).toEqual({ ok: true, payAmount: 150 })
  })

  it("does not lock independent live-lookup payment after catalog authorized", () => {
    const result = assertPaymentAuthorized({
      sellerId: "live:mca-unrelated",
      amount: 200,
      action: "hold",
      decision: decision("hold", { effectiveAmount: 200 }),
      shoppingStatus: "authorized",
      shoppingChosenSellerId: "live:chosen",
      shoppingCatalogSellerIds: ["live:chosen", "live:other"],
    })
    expect(result).toEqual({ ok: true, payAmount: 200 })
  })

  it("does not lock seed HOLD after catalog requires_confirmation", () => {
    const result = assertPaymentAuthorized({
      sellerId: "seller-001",
      amount: 450,
      action: "hold",
      decision: decision("hold", { effectiveAmount: 450 }),
      shoppingStatus: "requires_confirmation",
      shoppingChosenSellerId: "live:conifer",
      shoppingCatalogSellerIds: ["live:conifer"],
    })
    expect(result).toEqual({ ok: true, payAmount: 450 })
  })

  it("blocks refuse decisions", () => {
    const result = assertPaymentAuthorized({
      sellerId: "seller-bad",
      amount: 50,
      action: "capture",
      decision: decision("refuse"),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/refused/i)
    }
  })
})
