import { describe, it, expect } from "vitest"
import { applyGstConfidenceOverlay } from "@/lib/gst/applyGstConfidence"
import type { ConfidenceResult } from "@/lib/trust/confidence"
import type { GstTaxpayerRecord } from "@/lib/gst/verifyGstin"
import { gstinCheckDigit } from "@/lib/gst/validateGstin"

const lowBase: ConfidenceResult = {
  level: 15,
  band: "low",
  reasons: ["Not found in MCA"],
  adverseStatus: false,
  elevatedRisk: false,
}

function gst(
  overrides: Partial<GstTaxpayerRecord> = {}
): GstTaxpayerRecord {
  const body = "27AADCB2230M1Z"
  const gstin = body + gstinCheckDigit(body)
  return {
    gstin,
    legalName: null,
    tradeName: null,
    status: null,
    statusNormalized: null,
    registrationDate: null,
    source: "format-only",
    validation: { ok: true, gstin },
    ...overrides,
  }
}

describe("applyGstConfidenceOverlay", () => {
  it("bumps low MCA-miss slightly on format-only GSTIN", () => {
    const result = applyGstConfidenceOverlay(lowBase, gst())
    expect(result.level).toBeGreaterThanOrEqual(25)
    expect(result.band).toBe("low")
    expect(result.reasons.some((r) => /GSTIN/.test(r))).toBe(true)
  })

  it("stays low-band when GST Active with legal name but MCA missed", () => {
    const result = applyGstConfidenceOverlay(
      lowBase,
      gst({
        source: "portal",
        legalName: "ANAX IMPEX PRIVATE LIMITED",
        status: "Active",
        statusNormalized: "active",
      })
    )
    expect(result.band).toBe("low")
    expect(result.level).toBeGreaterThanOrEqual(30)
    expect(result.level).toBeLessThan(45)
    expect(result.reasons.some((r) => /GST Active/.test(r))).toBe(true)
  })

  it("does not wash MCA elevated risk with Active GST", () => {
    const dormantBase: ConfidenceResult = {
      level: 20,
      band: "low",
      reasons: ["MCA status is Dormant"],
      adverseStatus: false,
      elevatedRisk: true,
    }
    const result = applyGstConfidenceOverlay(
      dormantBase,
      gst({
        source: "portal",
        legalName: "SLEEPY CO PRIVATE LIMITED",
        status: "Active",
        statusNormalized: "active",
      })
    )
    expect(result.elevatedRisk).toBe(true)
    expect(result.band).toBe("low")
    expect(result.level).toBe(20)
  })

  it("corroborates an existing MCA medium band without promoting to high", () => {
    const mediumBase: ConfidenceResult = {
      level: 50,
      band: "medium",
      reasons: ["Found in MCA registry", "Recently registered"],
      adverseStatus: false,
      elevatedRisk: false,
    }
    const result = applyGstConfidenceOverlay(
      mediumBase,
      gst({
        source: "portal",
        legalName: "YOUNG ACTIVE CO",
        status: "Active",
        statusNormalized: "active",
      })
    )
    expect(result.band).toBe("medium")
    expect(result.level).toBeGreaterThanOrEqual(55)
  })

  it("marks adverse on cancelled GST", () => {
    const result = applyGstConfidenceOverlay(
      lowBase,
      gst({
        source: "portal",
        legalName: "BAD CO",
        status: "Cancelled",
        statusNormalized: "cancelled",
      })
    )
    expect(result.adverseStatus).toBe(true)
    expect(result.elevatedRisk).toBe(true)
    expect(result.band).toBe("low")
  })
})
