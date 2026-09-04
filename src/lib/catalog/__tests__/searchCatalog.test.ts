import { describe, it, expect, vi, beforeEach } from "vitest"
import { search_catalog } from "@/lib/catalog/searchCatalog"
import type { CatalogCandidate } from "@/lib/catalog/types"
import type { AgentContext } from "@/lib/agent/context"
import type { UserPolicy } from "@/lib/types"

const userPolicy: UserPolicy = {
  max_spend_per_transaction: 5000,
  max_spend_per_seller: 10000,
  confirm_above_amount: 300,
  hold_expiry_seconds: 3600,
}

vi.mock("@/lib/catalog/providers/indiamart", () => ({
  searchIndiamart: vi.fn(),
}))

vi.mock("@/lib/agent/lookupUnknownMerchant", () => ({
  runLookupUnknownMerchant: vi.fn(),
}))

vi.mock("@/lib/audit/logger", () => ({
  logAudit: vi.fn(),
}))

import { searchIndiamart } from "@/lib/catalog/providers/indiamart"
import { runLookupUnknownMerchant } from "@/lib/agent/lookupUnknownMerchant"

function makeCtx(): AgentContext {
  return {
    decisionsBySellerId: {},
    trustChecks: [],
    liveMerchants: {},
  }
}

function candidate(
  name: string,
  amount: number | null
): CatalogCandidate {
  return {
    merchantName: name,
    amount,
    currency: "INR",
    source: "indiamart",
    sourceUrl: null,
    city: null,
    gstin: null,
  }
}

describe("search_catalog (evaluate-only)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns noSuppliers when catalog is empty", async () => {
    vi.mocked(searchIndiamart).mockResolvedValue([])

    const result = await search_catalog(
      { query: "white star wars t-shirt" },
      makeCtx(),
      userPolicy
    )

    expect(result.noSuppliers).toBe(true)
    expect(result.candidates).toHaveLength(0)
    expect(result.summary).toMatch(/No suppliers found/i)
    expect(runLookupUnknownMerchant).not.toHaveBeenCalled()
  })

  it("evaluates candidates without ranking or choosing", async () => {
    vi.mocked(searchIndiamart).mockResolvedValue([
      candidate("Alpha Traders", 100),
      candidate("Beta Mart", 90),
    ])
    vi.mocked(runLookupUnknownMerchant)
      .mockResolvedValueOnce({
        sellerId: "live:a",
        sellerName: "Alpha Traders",
        recommendedAction: "refuse",
        effectiveScore: 20,
        effectiveTier: "low",
        riskScore: 20,
        trustReason: "low confidence",
      } as never)
      .mockResolvedValueOnce({
        sellerId: "live:b",
        sellerName: "Beta Mart",
        recommendedAction: "hold",
        effectiveScore: 15,
        effectiveTier: "low",
        riskScore: 15,
        trustReason: "no match",
      } as never)

    const ctx = makeCtx()
    const result = await search_catalog(
      { query: "t-shirt", budget: 200 },
      ctx,
      userPolicy
    )

    expect(result.noSuppliers).toBe(false)
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.map((c) => c.recommendedAction)).toEqual([
      "refuse",
      "hold",
    ])
    expect(ctx.chosenSellerId).toBeUndefined()
  })

  it("preserves TrustGate actions for CAPTURE, HOLD, and REFUSE", async () => {
    vi.mocked(searchIndiamart).mockResolvedValue([
      candidate("Cheap Bad Co", 50),
      candidate("Mid Good Co", 120),
      candidate("Pricey Hold Co", 200),
    ])
    vi.mocked(runLookupUnknownMerchant)
      .mockResolvedValueOnce({
        sellerId: "live:cheap",
        sellerName: "Cheap Bad Co",
        recommendedAction: "refuse",
        effectiveScore: 10,
        effectiveTier: "low",
        riskScore: 10,
        trustReason: "unverified",
      } as never)
      .mockResolvedValueOnce({
        sellerId: "live:mid",
        sellerName: "Mid Good Co",
        recommendedAction: "capture",
        effectiveScore: 80,
        effectiveTier: "high",
        riskScore: 60,
        trustReason: "registry verified",
      } as never)
      .mockResolvedValueOnce({
        sellerId: "live:pricey",
        sellerName: "Pricey Hold Co",
        recommendedAction: "hold",
        effectiveScore: 75,
        effectiveTier: "high",
        riskScore: 55,
        trustReason: "registry verified",
      } as never)

    const result = await search_catalog(
      { query: "cotton tee", budget: 500 },
      makeCtx(),
      userPolicy
    )

    expect(result.candidates).toHaveLength(3)
    expect(result.candidates[0].recommendedAction).toBe("refuse")
    expect(result.candidates[1].recommendedAction).toBe("capture")
    expect(result.candidates[2].recommendedAction).toBe("hold")
  })

  it("falls back to userPolicy budget and states it explicitly", async () => {
    vi.mocked(searchIndiamart).mockResolvedValue([
      candidate("No Price Co", null),
    ])
    vi.mocked(runLookupUnknownMerchant).mockResolvedValue({
      sellerId: "live:np",
      sellerName: "No Price Co",
      recommendedAction: "hold",
      effectiveScore: 70,
      effectiveTier: "medium",
      riskScore: 50,
      trustReason: "trial",
    } as never)

    const result = await search_catalog(
      { query: "gadget" },
      makeCtx(),
      userPolicy
    )

    expect(result.usedDefaultBudget).toBe(true)
    expect(result.budget).toBe(5000)
    expect(result.budgetNote).toMatch(
      /no budget specified, using your default limit of ₹5000/i
    )
    expect(runLookupUnknownMerchant).toHaveBeenCalledWith(
      expect.anything(),
      userPolicy,
      { name: "No Price Co", amount: 5000, gstin: undefined }
    )
  })
})
