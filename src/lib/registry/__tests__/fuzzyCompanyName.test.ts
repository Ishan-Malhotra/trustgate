import { describe, it, expect } from "vitest"
import {
  buildFuzzyNameCandidates,
  normalizeAggressive,
  pickBestFuzzyMatch,
  scoreNameSimilarity,
  stripLegalSuffix,
  FUZZY_MCA_MIN_SCORE,
} from "@/lib/registry/fuzzyCompanyName"

describe("fuzzyCompanyName", () => {
  it("normalizes punctuation and ampersands", () => {
    expect(normalizeAggressive("A.S.International")).toBe("A S INTERNATIONAL")
    expect(normalizeAggressive("Foo & Bar")).toBe("FOO AND BAR")
  })

  it("strips legal suffixes for core comparison", () => {
    expect(stripLegalSuffix("BERRYBLUES EXPORT PRIVATE LIMITED")).toBe(
      "BERRYBLUES EXPORT"
    )
    expect(stripLegalSuffix("INFOSYS LIMITED")).toBe("INFOSYS")
  })

  it("builds punctuation and suffix variants", () => {
    const candidates = buildFuzzyNameCandidates("A.S.International")
    expect(candidates.some((c) => c.includes("A S INTERNATIONAL"))).toBe(true)
    expect(candidates.some((c) => c.includes("AS INTERNATIONAL"))).toBe(true)
    expect(
      candidates.some((c) => c.includes("PRIVATE LIMITED") || c.endsWith("LTD"))
    ).toBe(true)
    expect(candidates.length).toBeLessThanOrEqual(12)
  })

  it("scores trade name highly against full legal name", () => {
    const score = scoreNameSimilarity(
      "Berryblues Export",
      "BERRYBLUES EXPORT (OPC) PRIVATE LIMITED"
    )
    expect(score).toBeGreaterThanOrEqual(FUZZY_MCA_MIN_SCORE)
  })

  it("scores Infosys short name against INFOSYS LIMITED", () => {
    expect(scoreNameSimilarity("INFOSYS", "INFOSYS LIMITED")).toBeGreaterThanOrEqual(
      FUZZY_MCA_MIN_SCORE
    )
  })

  it("rejects unrelated company names", () => {
    const score = scoreNameSimilarity("S Creation", "INFOSYS LIMITED")
    expect(score).toBeLessThan(FUZZY_MCA_MIN_SCORE)
  })

  it("picks best fuzzy match and fails closed below threshold", () => {
    const records = [
      {
        companyName: "RANDOM TRADERS PRIVATE LIMITED",
        status: "Active",
      },
      {
        companyName: "BERRYBLUES EXPORT PRIVATE LIMITED",
        status: "Active",
      },
    ]
    const picked = pickBestFuzzyMatch("Berryblues Export", records)
    expect(picked?.record.companyName).toBe(
      "BERRYBLUES EXPORT PRIVATE LIMITED"
    )
    expect(picked!.score).toBeGreaterThanOrEqual(FUZZY_MCA_MIN_SCORE)

    const none = pickBestFuzzyMatch("Completely Different Co", records)
    expect(none).toBeNull()
  })
})
