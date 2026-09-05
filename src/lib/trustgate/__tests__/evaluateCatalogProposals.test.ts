import { describe, it, expect, vi, beforeEach } from "vitest"
import { evaluateCatalogProposals } from "@/lib/trustgate/evaluateCatalogProposals"
import type { CatalogCandidate } from "@/lib/catalog/types"
import type { AgentContext } from "@/lib/agent/context"
import type { UserPolicy } from "@/lib/types"

vi.mock("@/lib/agent/lookupUnknownMerchant", () => ({
  runLookupUnknownMerchant: vi.fn(),
}))

vi.mock("@/lib/audit/logger", () => ({
  logAudit: vi.fn(),
}))

vi.mock("@/lib/razorpay/executePayment", () => ({
  executeApprovedPayment: vi.fn(),
}))

import { runLookupUnknownMerchant } from "@/lib/agent/lookupUnknownMerchant"
import { executeApprovedPayment } from "@/lib/razorpay/executePayment"

const userPolicy: UserPolicy = {
  max_spend_per_transaction: 5000,
  max_spend_per_seller: 10000,
  confirm_above_amount: 300,
  hold_expiry_seconds: 3600,
}

function makeCtx(): AgentContext {
  return {
    decisionsBySellerId: {},
    trustChecks: [],
    liveMerchants: {},
  }
}

function cand(
  productName: string,
  amount: number,
  seller = "Seller"
): CatalogCandidate {
  return {
    merchantName: seller,
    amount,
    currency: "INR",
    source: "indiamart",
    sourceUrl: null,
    city: null,
    productName,
    gstin: null,
  }
}

describe("evaluateCatalogProposals", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("PS5 + controller cover → REFUSE, no Razorpay", async () => {
    const { evaluated } = await evaluateCatalogProposals(
      "Buy me a PS5",
      [cand("PS5 Controller Cover", 200, "Accessory Co")],
      makeCtx(),
      userPolicy,
      5000
    )
    expect(evaluated[0].recommendedAction).toBe("refuse")
    expect(evaluated[0].productIntegrity?.match).toBe(false)
    expect(runLookupUnknownMerchant).not.toHaveBeenCalled()
    expect(executeApprovedPayment).not.toHaveBeenCalled()
  })

  it("camera + lens cap → REFUSE", async () => {
    const { evaluated } = await evaluateCatalogProposals(
      "Buy me a camera",
      [cand("Camera Lens Cap", 50)],
      makeCtx(),
      userPolicy,
      5000
    )
    expect(evaluated[0].recommendedAction).toBe("refuse")
  })

  it("PS5 console passes product check then uses seller lookup", async () => {
    vi.mocked(runLookupUnknownMerchant).mockResolvedValue({
      sellerId: "live:sony",
      sellerName: "Sony Store",
      recommendedAction: "capture",
      effectiveScore: 80,
      effectiveTier: "high",
      trustReason: "verified",
    } as never)

    const { evaluated } = await evaluateCatalogProposals(
      "Buy me a PS5",
      [cand("Sony PlayStation 5 Console", 39999, "Sony Store")],
      makeCtx(),
      userPolicy,
      50000
    )
    expect(evaluated[0].productIntegrity?.match).toBe(true)
    expect(evaluated[0].recommendedAction).toBe("capture")
    expect(runLookupUnknownMerchant).toHaveBeenCalled()
  })

  it("₹200 PS5 in a tiny batch does not fire price anomaly (<5 pool)", async () => {
    vi.mocked(runLookupUnknownMerchant).mockResolvedValue({
      sellerId: "live:ok",
      recommendedAction: "capture",
      effectiveScore: 80,
      effectiveTier: "high",
      trustReason: "registry verified",
    } as never)

    const { evaluated } = await evaluateCatalogProposals(
      "Buy me a PS5",
      [
        cand("Sony PlayStation 5 Console", 200, "Too Cheap"),
        cand("Sony PlayStation 5 Console", 39999, "Fair A"),
        cand("Sony PlayStation 5 Console", 42000, "Fair B"),
      ],
      makeCtx(),
      userPolicy,
      50000
    )

    const cheap = evaluated.find((e) => e.candidate.amount === 200)
    expect(cheap?.priceIntegrity?.anomaly).toBe("none")
    expect(cheap?.priceIntegrity?.reason).toMatch(/insufficient sample|pool size/i)
    expect(cheap?.recommendedAction).toBe("capture")
    expect(runLookupUnknownMerchant).toHaveBeenCalled()
  })

  it("extreme price with large pool + clean MCA is NOT refused on price alone", async () => {
    vi.mocked(runLookupUnknownMerchant).mockResolvedValue({
      sellerId: "live:ok",
      recommendedAction: "capture",
      effectiveScore: 85,
      effectiveTier: "high",
      trustReason: "MCA Active — high confidence",
      confidenceBand: "high",
    } as never)

    const { evaluated } = await evaluateCatalogProposals(
      "Buy me a PS5",
      [
        cand("Sony PlayStation 5 Console", 200, "Too Cheap"),
        cand("Sony PlayStation 5 Console", 39999, "Fair A"),
        cand("Sony PlayStation 5 Console", 42000, "Fair B"),
        cand("Sony PlayStation 5 Console", 41000, "Fair C"),
        cand("Sony PlayStation 5 Console", 40500, "Fair D"),
      ],
      makeCtx(),
      userPolicy,
      50000
    )

    const cheap = evaluated.find((e) => e.candidate.amount === 200)
    expect(cheap?.priceIntegrity?.anomaly).toBe("extreme")
    expect(cheap?.recommendedAction).toBe("capture")
    expect(cheap?.trustReason).toMatch(/soft price signal/i)
  })

  it("₹4500 camera among peers is not refused for being cheapest", async () => {
    vi.mocked(runLookupUnknownMerchant).mockResolvedValue({
      sellerId: "live:cam",
      recommendedAction: "capture",
      effectiveScore: 75,
      effectiveTier: "high",
    } as never)

    const { evaluated } = await evaluateCatalogProposals(
      "Buy me a camera",
      [
        cand("DSLR Camera Body", 4500, "Budget Cam"),
        cand("DSLR Camera Body", 5200, "Mid Cam"),
        cand("DSLR Camera Body", 6000, "Pro Cam"),
      ],
      makeCtx(),
      userPolicy,
      10000
    )

    const cheap = evaluated.find((e) => e.candidate.amount === 4500)
    expect(cheap?.priceIntegrity?.anomaly).toBe("none")
    expect(cheap?.recommendedAction).toBe("capture")
  })

  it("valid product + refused seller → REFUSE", async () => {
    vi.mocked(runLookupUnknownMerchant).mockResolvedValue({
      sellerId: "live:bad",
      recommendedAction: "refuse",
      trustReason: "struck off",
    } as never)

    const { evaluated } = await evaluateCatalogProposals(
      "Buy me a PS5",
      [cand("Sony PlayStation 5 Console", 39999)],
      makeCtx(),
      userPolicy,
      50000
    )
    expect(evaluated[0].recommendedAction).toBe("refuse")
  })

  it("valid product + HOLD seller → remains HOLD", async () => {
    vi.mocked(runLookupUnknownMerchant).mockResolvedValue({
      sellerId: "live:hold",
      recommendedAction: "hold",
      trustReason: "low confidence",
    } as never)

    const { evaluated } = await evaluateCatalogProposals(
      "Buy me a PS5",
      [cand("Sony PlayStation 5 Console", 39999)],
      makeCtx(),
      userPolicy,
      50000
    )
    expect(evaluated[0].recommendedAction).toBe("hold")
  })

  it("no valid product → all refuse and unreliable/caution warning", async () => {
    const { evaluated, shoppingReliability } = await evaluateCatalogProposals(
      "Buy me a PS5",
      [
        cand("PS5 Controller Cover", 200),
        cand("PS5 Case Skin", 150),
      ],
      makeCtx(),
      userPolicy,
      5000
    )
    expect(evaluated.every((e) => e.recommendedAction === "refuse")).toBe(true)
    expect(shoppingReliability.level).toBe("unreliable")
    expect(executeApprovedPayment).not.toHaveBeenCalled()
  })
})
