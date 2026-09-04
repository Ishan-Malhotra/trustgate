import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  applyShoppingDecision,
  runShoppingAgent,
} from "@/lib/agent/shoppingAgent"
import type {
  CatalogCandidate,
  CatalogEvaluatedCandidate,
  CatalogEvaluationResult,
} from "@/lib/catalog/types"
import type { AgentContext } from "@/lib/agent/context"
import type { UserPolicy } from "@/lib/types"

const userPolicy: UserPolicy = {
  max_spend_per_transaction: 5000,
  max_spend_per_seller: 10000,
  confirm_above_amount: 300,
  hold_expiry_seconds: 3600,
}

vi.mock("@/lib/catalog/searchCatalog", () => ({
  search_catalog: vi.fn(),
}))

vi.mock("@/lib/audit/logger", () => ({
  logAudit: vi.fn(),
}))

vi.mock("@/lib/razorpay/executePayment", () => ({
  executeApprovedPayment: vi.fn(),
}))

import { search_catalog } from "@/lib/catalog/searchCatalog"
import { executeApprovedPayment } from "@/lib/razorpay/executePayment"

function makeCtx(): AgentContext {
  return {
    decisionsBySellerId: {},
    trustChecks: [],
    liveMerchants: {},
  }
}

function candidate(name: string, amount: number | null): CatalogCandidate {
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

function evaluated(
  name: string,
  amount: number,
  action: "capture" | "hold" | "refuse",
  sellerId?: string,
  trustReason?: string
): CatalogEvaluatedCandidate {
  return {
    candidate: candidate(name, amount),
    amountUsed: amount,
    sellerId: sellerId ?? `live:${name}`,
    recommendedAction: action,
    trustReason,
  }
}

function evaluation(
  rows: CatalogEvaluatedCandidate[],
  extras?: Partial<CatalogEvaluationResult>
): CatalogEvaluationResult {
  return {
    query: "towel",
    budget: 5000,
    usedDefaultBudget: true,
    candidates: rows,
    noSuppliers: false,
    ...extras,
  }
}

describe("applyShoppingDecision / runShoppingAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("Test 1 — cheapest CAPTURE wins among HOLD and CAPTURE options", () => {
    const result = applyShoppingDecision(
      evaluation([
        evaluated("Hold Cheap", 100, "hold"),
        evaluated("Capture Mid", 150, "capture"),
        evaluated("Capture High", 200, "capture"),
      ])
    )

    expect(result.status).toBe("authorized")
    expect(result.chosen?.candidate.merchantName).toBe("Capture Mid")
    expect(result.chosen?.candidate.amount).toBe(150)
    expect(result.chosen?.recommendedAction).toBe("capture")
    expect(result.approved).toHaveLength(2)
    expect(result.holds).toHaveLength(1)
  })

  it("Test 2 — HOLD does not beat CAPTURE even when cheaper", () => {
    const result = applyShoppingDecision(
      evaluation([
        evaluated("Hold Cheap", 50, "hold"),
        evaluated("Capture Only", 100, "capture"),
      ])
    )

    expect(result.status).toBe("authorized")
    expect(result.chosen?.candidate.merchantName).toBe("Capture Only")
    expect(result.chosen?.candidate.amount).toBe(100)
    expect(result.chosen?.recommendedAction).toBe("capture")
    expect(result.summary).toMatch(/Skipped 1 HOLD/i)
  })

  it("Test 3 — cheapest HOLD when no CAPTURE", () => {
    const result = applyShoppingDecision(
      evaluation([
        evaluated("Conifer Handmades", 67, "hold", "live:conifer", "low confidence"),
        evaluated("Priyan Tex", 100, "hold"),
        evaluated("SHIVA ARTS", 199, "refuse"),
      ])
    )

    expect(result.status).toBe("requires_confirmation")
    expect(result.chosen?.candidate.merchantName).toBe("Conifer Handmades")
    expect(result.chosen?.candidate.amount).toBe(67)
    expect(result.chosen?.recommendedAction).toBe("hold")
    expect(result.approved).toHaveLength(0)
    expect(result.holds).toHaveLength(2)
    expect(result.summary).toMatch(/requires_confirmation/i)
    expect(result.summary).toMatch(/Do NOT call authorizeOrCapture/i)
  })

  it("Test 4 — all refused → no_viable", () => {
    const result = applyShoppingDecision(
      evaluation([
        evaluated("A", 67, "refuse"),
        evaluated("B", 100, "refuse"),
      ])
    )

    expect(result.status).toBe("no_viable")
    expect(result.chosen).toBeUndefined()
    expect(result.approved).toHaveLength(0)
    expect(result.holds).toHaveLength(0)
    expect(result.summary).toMatch(/no_viable/i)
  })

  it("Test 5 — HOLD is never sent to payment automatically", async () => {
    vi.mocked(search_catalog).mockResolvedValue(
      evaluation([
        evaluated("Conifer Handmades", 67, "hold", "live:conifer"),
        evaluated("Priyan Tex", 100, "hold"),
      ])
    )

    const result = await runShoppingAgent(
      { query: "towel" },
      makeCtx(),
      userPolicy
    )

    expect(result.status).toBe("requires_confirmation")
    expect(result.shoppingAgent).toBe(true)
    expect(executeApprovedPayment).not.toHaveBeenCalled()
    expect(result.summary).toMatch(/Do NOT call authorizeOrCapture/i)
    expect(result.reason).toMatch(/requires_confirmation/i)
  })

  it("Test 6 — HOLD language is held / confirmation, not purchased", () => {
    const result = applyShoppingDecision(
      evaluation([
        evaluated(
          "Conifer Handmades",
          67,
          "hold",
          "live:conifer",
          "insufficient verifiable history"
        ),
      ])
    )

    expect(result.status).toBe("requires_confirmation")
    expect(result.summary).toMatch(/bounded hold \/ requires confirmation/i)
    expect(result.summary).not.toMatch(/successfully purchased/i)
    expect(result.summary).not.toMatch(/payment captured/i)
    expect(result.summary).not.toMatch(/authorized for automatic purchase/i)
    expect(result.reason).toMatch(/No seller was eligible for automatic capture/i)
  })

  it("photoframe: CAPTURE Bharat beats cheaper HOLD Conifer", () => {
    const result = applyShoppingDecision(
      evaluation(
        [
          evaluated("Conifer Handmades", 67, "hold"),
          evaluated("SHIVA ARTS", 199, "refuse"),
          evaluated("Bharat Enterprises", 95, "capture"),
        ],
        { query: "photoframe" }
      )
    )

    expect(result.status).toBe("authorized")
    expect(result.chosen?.candidate.merchantName).toBe("Bharat Enterprises")
    expect(result.chosen?.candidate.amount).toBe(95)
  })
})
