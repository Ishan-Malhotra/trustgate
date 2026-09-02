import { describe, it, expect } from "vitest"
import {
  buildDeterministicExplanation,
  buildExplanationSellerFacts,
  classifyPrimaryReason,
  validateExplanationText,
} from "@/lib/explanation/explanationFacts"
import type { SellerTrustCheck } from "@/lib/types"

const mahavir: SellerTrustCheck = {
  sellerId: "live:cirp",
  sellerName: "MAHAVIR INDUSTRIES LIMITED",
  amount: 25,
  score: 10,
  tier: "low",
  riskScore: 10,
  riskTier: "low",
  effectiveScore: 10,
  effectiveTier: "low",
  spendLimit: 0,
  recommendedAction: "refuse",
  trustReason:
    "Elevated registry risk (MCA status is Under CIRP (not Active)) — seller refused",
  confidenceLevel: 25,
  confidenceBand: "low",
  confidenceReasons: ["MCA status is Under CIRP (not Active) — adverse registry signal"],
  liveLookup: true,
}

const anax: SellerTrustCheck = {
  sellerId: "live:anax",
  sellerName: "Anax Impex",
  amount: 25,
  score: 0,
  tier: "low",
  riskScore: 0,
  riskTier: "low",
  effectiveScore: 0,
  effectiveTier: "low",
  spendLimit: 200,
  recommendedAction: "hold",
  trustReason: "Insufficient verifiable history — trial spend capped at ₹200",
  confidenceLevel: 15,
  confidenceBand: "low",
  confidenceReasons: [
    "Not found in MCA Company Master Data — insufficient verifiable history",
  ],
  liveLookup: true,
}

const saijee: SellerTrustCheck = {
  sellerId: "live:saijee",
  sellerName: "Saijee Impex",
  amount: 120,
  score: 0,
  tier: "low",
  riskScore: 0,
  riskTier: "low",
  effectiveScore: 0,
  effectiveTier: "low",
  spendLimit: 200,
  recommendedAction: "hold",
  trustReason: "Insufficient verifiable history — trial spend capped at ₹200",
  confidenceLevel: 15,
  confidenceBand: "low",
  confidenceReasons: [
    "Not found in MCA Company Master Data — insufficient verifiable history",
  ],
  liveLookup: true,
}

describe("classifyPrimaryReason", () => {
  it("labels CIRP refusal as adverse registry, not confidence", () => {
    const result = classifyPrimaryReason(mahavir)
    expect(result.primaryReasonType).toBe("adverse_registry_status")
    expect(result.primaryReasonDetail).toMatch(/CIRP/i)
  })

  it("labels MCA miss holds as insufficient confidence", () => {
    const result = classifyPrimaryReason(anax)
    expect(result.primaryReasonType).toBe("insufficient_confidence")
    expect(result.primaryReasonDetail).toMatch(/insufficient verifiable history/i)
  })
})

describe("buildDeterministicExplanation", () => {
  it("cites each seller's own reason without cross-contamination", () => {
    const sellers = [mahavir, anax, saijee].map(buildExplanationSellerFacts)
    const text = buildDeterministicExplanation("Anax Impex", sellers)

    expect(text).toMatch(/MAHAVIR INDUSTRIES LIMITED was refused:.*CIRP/i)
    expect(text).not.toMatch(/MAHAVIR.*15/i)
    expect(text).not.toMatch(/refused.*scoring 15/i)
    expect(text).toMatch(/Anax Impex was held:.*Insufficient verifiable history/i)
  })
})

describe("validateExplanationText", () => {
  it("rejects LLM text that misattributes Anax confidence to MAHAVIR", () => {
    const sellers = [mahavir, anax, saijee].map(buildExplanationSellerFacts)
    const badLlm =
      "Anax Impex was chosen. MAHAVIR INDUSTRIES LIMITED was refused due to risk signals scoring 15."

    expect(validateExplanationText(badLlm, sellers)).toBe(false)
  })

  it("accepts text that cites CIRP for MAHAVIR without other sellers' confidence", () => {
    const sellers = [mahavir, anax, saijee].map(buildExplanationSellerFacts)
    const good =
      "Anax Impex held for insufficient verifiable history. MAHAVIR INDUSTRIES LIMITED was refused: MCA status is Under CIRP (not Active). Saijee Impex held: not found in MCA."

    expect(validateExplanationText(good, sellers)).toBe(true)
  })
})
