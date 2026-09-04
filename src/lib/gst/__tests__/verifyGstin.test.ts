import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  clearGstCache,
  verifyGstin,
} from "@/lib/gst/verifyGstin"
import { gstinCheckDigit } from "@/lib/gst/validateGstin"

vi.mock("@/lib/audit/logger", () => ({
  logAudit: vi.fn(),
}))

vi.mock("@/lib/config/env", () => ({
  getEnvValue: vi.fn(() => undefined),
}))

function validGstin(body14 = "27AADCB2230M1Z"): string {
  return body14 + gstinCheckDigit(body14)
}

describe("verifyGstin", () => {
  beforeEach(() => {
    clearGstCache()
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns invalid source for bad GSTIN without throwing", async () => {
    const result = await verifyGstin("bad")
    expect(result?.source).toBe("invalid")
    expect(result?.validation.ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("returns format-only when portal is unreachable", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: { get: () => "text/html" },
      text: async () => "<html>rejected</html>",
    } as unknown as Response)

    const gstin = validGstin()
    const result = await verifyGstin(gstin)
    expect(result?.source).toBe("format-only")
    expect(result?.validation.ok).toBe(true)
    expect(result?.legalName).toBeNull()
  })

  it("maps portal JSON taxpayer details", async () => {
    const gstin = validGstin()
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        lgnm: "ANAX IMPEX PRIVATE LIMITED",
        tradeNam: "Anax Impex",
        sts: "Active",
        rgdt: "01/01/2018",
      }),
    } as unknown as Response)

    const result = await verifyGstin(gstin)
    expect(result?.source).toBe("portal")
    expect(result?.legalName).toBe("ANAX IMPEX PRIVATE LIMITED")
    expect(result?.statusNormalized).toBe("active")
  })

  it("does not throw on network failure — format-only", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("aborted"))
    const result = await verifyGstin(validGstin())
    expect(result?.source).toBe("format-only")
  })
})
