import { describe, it, expect } from "vitest"
import {
  gstinCheckDigit,
  validateGstin,
  validateGstinChecksum,
} from "@/lib/gst/validateGstin"

describe("validateGstin", () => {
  it("accepts a checksum-valid GSTIN", () => {
    const body = "27AADCB2230M1Z"
    const gstin = body + gstinCheckDigit(body)
    const result = validateGstin(gstin)
    expect(result.ok).toBe(true)
    expect(result.stateName).toBe("Maharashtra")
    expect(result.pan).toBe("AADCB2230M")
  })

  it("rejects bad checksum", () => {
    const result = validateGstin("27AADCB2230M1Z0")
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("checksum")
  })

  it("rejects bad format", () => {
    expect(validateGstin("NOT-A-GSTIN").ok).toBe(false)
    expect(validateGstin("").ok).toBe(false)
  })

  it("validateGstinChecksum matches helper", () => {
    const body = "29AAACI1681G1Z"
    const gstin = body + gstinCheckDigit(body)
    expect(validateGstinChecksum(gstin)).toBe(true)
    expect(validateGstinChecksum(body + "0")).toBe(false)
  })
})
