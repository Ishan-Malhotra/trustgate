import { describe, it, expect } from "vitest"
import {
  buildDeterministicExplanation,
  buildExplanationSellerFacts,
  classifyPrimaryReason,
  resolveExplanationSellers,
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

describe("classifyPrimaryReason / multi-reason", () => {
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

  it("lists trust/confidence before policy when both apply", () => {
    const jewel: SellerTrustCheck = {
      sellerId: "live:jewel",
      sellerName: "Custom Diam Jewel",
      amount: 12000,
      score: 0,
      tier: "low",
      riskScore: 0,
      riskTier: "low",
      effectiveScore: 0,
      effectiveTier: "low",
      spendLimit: 200,
      recommendedAction: "refuse",
      trustReason: "Insufficient verifiable history — trial spend capped at ₹200",
      policyReason:
        "Amount ₹12000 exceeds max_spend_per_transaction (₹5000)",
      confidenceLevel: 15,
      confidenceBand: "low",
      confidenceReasons: [
        "Not found in MCA Company Master Data — insufficient verifiable history",
      ],
      liveLookup: true,
    }

    const result = classifyPrimaryReason(jewel)
    expect(result.reasons.map((r) => r.type)).toEqual([
      "insufficient_confidence",
      "policy_threshold",
    ])
    expect(result.primaryReasonType).toBe("insufficient_confidence")

    const facts = buildExplanationSellerFacts(jewel)
    const text = buildDeterministicExplanation("Custom Diam Jewel", [facts])
    expect(text).toMatch(/insufficient verifiable history/i)
    expect(text).toMatch(/also/i)
    expect(text).toMatch(/exceeds.*₹?5000|max_spend/i)
  })

  it("keeps single-reason sellers as a single citation", () => {
    const facts = buildExplanationSellerFacts(anax)
    expect(facts.reasons).toHaveLength(1)
    const text = buildDeterministicExplanation("Anax Impex", [facts])
    expect(text).toMatch(/Anax Impex was held:.*Insufficient verifiable history/i)
    expect(text).not.toMatch(/also/i)
  })
})

describe("resolveExplanationSellers", () => {
  it("appends a synthesized chosen seller when they are missing from comparison", () => {
    const { chosenSeller, sellers } = resolveExplanationSellers(
      "Anax Impex",
      [mahavir, saijee],
      anax
    )

    expect(chosenSeller.name).toBe("Anax Impex")
    expect(sellers.map((s) => s.name)).toEqual([
      "MAHAVIR INDUSTRIES LIMITED",
      "Saijee Impex",
      "Anax Impex",
    ])

    const text = buildDeterministicExplanation("Anax Impex", sellers)
    expect(text).toMatch(/Anax Impex was held:/)
    expect(text).not.toMatch(/^Saijee Impex was held:/)
  })

  it("uses the synthesized chosen seller when comparison is empty", () => {
    const { sellers } = resolveExplanationSellers("Anax Impex", [], anax)
    const text = buildDeterministicExplanation("Anax Impex", sellers)

    expect(sellers).toHaveLength(1)
    expect(text).toMatch(/Anax Impex was held:.*Insufficient verifiable history/i)
    expect(text).not.toBe("Decision processed.")
  })

  it("does not duplicate the chosen seller when they are already in comparison", () => {
    const { sellers } = resolveExplanationSellers(
      "Anax Impex",
      [mahavir, anax, saijee],
      anax
    )
    expect(sellers.filter((s) => s.name === "Anax Impex")).toHaveLength(1)
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

  it("does not attribute another merchant when the chosen name is absent", () => {
    const sellers = [mahavir, saijee].map(buildExplanationSellerFacts)
    const text = buildDeterministicExplanation("Anax Impex", sellers)

    expect(text).toBe("Decision processed.")
    expect(text).not.toMatch(/Saijee Impex/)
  })
})

describe("validateExplanationText", () => {
  it("rejects LLM text that misattributes Anax confidence to MAHAVIR", () => {
    const sellers = [mahavir, anax, saijee].map(buildExplanationSellerFacts)
    const badLlm =
      "Anax Impex was chosen. MAHAVIR INDUSTRIES LIMITED was refused due to risk signals scoring 15."

    expect(validateExplanationText(badLlm, sellers)).toBe(false)
  })

  it("rejects prose that keeps only the policy reason when trust also applies", () => {
    const jewel = buildExplanationSellerFacts({
      sellerId: "live:jewel",
      sellerName: "Custom Diam Jewel",
      amount: 12000,
      score: 0,
      tier: "low",
      riskScore: 0,
      riskTier: "low",
      effectiveScore: 0,
      effectiveTier: "low",
      spendLimit: 200,
      recommendedAction: "refuse",
      trustReason: "Insufficient verifiable history — trial spend capped at ₹200",
      policyReason:
        "Amount ₹12000 exceeds max_spend_per_transaction (₹5000)",
      confidenceLevel: 15,
      confidenceBand: "low",
      confidenceReasons: [
        "Not found in MCA Company Master Data — insufficient verifiable history",
      ],
      liveLookup: true,
    })

    const policyOnly =
      "Custom Diam Jewel was refused because it exceeds your ₹5,000 policy limit."
    expect(validateExplanationText(policyOnly, [jewel])).toBe(false)

    const both =
      "Custom Diam Jewel was refused: insufficient verifiable history (₹200 cap); also exceeds your ₹5,000 policy limit."
    expect(validateExplanationText(both, [jewel])).toBe(true)
  })
})
