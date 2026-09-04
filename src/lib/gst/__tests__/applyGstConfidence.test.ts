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

  it("raises to medium when GST Active with legal name and MCA low", () => {
    const result = applyGstConfidenceOverlay(
      lowBase,
      gst({
        source: "portal",
        legalName: "ANAX IMPEX PRIVATE LIMITED",
        status: "Active",
        statusNormalized: "active",
      })
    )
    expect(result.band).toBe("medium")
    expect(result.level).toBeGreaterThanOrEqual(45)
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
