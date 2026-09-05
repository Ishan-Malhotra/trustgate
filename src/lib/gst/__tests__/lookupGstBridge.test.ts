import { describe, it, expect, vi, beforeEach } from "vitest"
import { runLookupUnknownMerchant } from "@/lib/agent/lookupUnknownMerchant"
import type { AgentContext } from "@/lib/agent/context"
import { USER_POLICY } from "@/lib/config/userPolicy"
import { gstinCheckDigit } from "@/lib/gst/validateGstin"

const userPolicy = USER_POLICY

vi.mock("@/lib/audit/logger", () => ({
  logAudit: vi.fn(),
}))

vi.mock("@/lib/registry/mcaLookup", () => ({
  searchCompanyDetailed: vi.fn(),
}))

vi.mock("@/lib/gst/verifyGstin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gst/verifyGstin")>(
    "@/lib/gst/verifyGstin"
  )
  return {
    ...actual,
    verifyGstin: vi.fn(),
  }
})

import { searchCompanyDetailed } from "@/lib/registry/mcaLookup"
import { verifyGstin } from "@/lib/gst/verifyGstin"

function makeCtx(): AgentContext {
  return {
    decisionsBySellerId: {},
    trustChecks: [],
    liveMerchants: {},
  }
}

describe("runLookupUnknownMerchant GST bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("retries MCA with GST legal name when trade name misses", async () => {
    const body = "27AADCB2230M1Z"
    const gstin = body + gstinCheckDigit(body)

    vi.mocked(searchCompanyDetailed)
      .mockResolvedValueOnce({
        record: null,
        source: "api",
        failureReason: "no-match",
      })
      .mockResolvedValueOnce({
        record: {
          cin: "U51909MH2018PTC123456",
          companyName: "ANAX IMPEX PRIVATE LIMITED",
          registrationDate: "2018-01-01",
          status: "Active",
          authorizedCapital: 1_000_000,
          paidupCapital: 500_000,
          state: "Maharashtra",
          nicCode: "51909",
          rocCode: "ROC Mumbai",
        },
        source: "api",
      })

    vi.mocked(verifyGstin).mockResolvedValue({
      gstin,
      legalName: "ANAX IMPEX PRIVATE LIMITED",
      tradeName: "Anax Impex",
      status: "Active",
      statusNormalized: "active",
      registrationDate: "01/01/2018",
      source: "portal",
      validation: { ok: true, gstin },
    })

    const result = await runLookupUnknownMerchant(
      makeCtx(),
      userPolicy,
      { name: "Anax Impex", amount: 25, gstin }
    )

    expect(searchCompanyDetailed).toHaveBeenCalledTimes(2)
    expect(searchCompanyDetailed).toHaveBeenNthCalledWith(1, "Anax Impex")
    expect(searchCompanyDetailed).toHaveBeenNthCalledWith(
      2,
      "ANAX IMPEX PRIVATE LIMITED"
    )
    expect(result.mcaRecord?.companyName).toBe("ANAX IMPEX PRIVATE LIMITED")
    expect(result.gst?.legalName).toBe("ANAX IMPEX PRIVATE LIMITED")
    expect(result.confidenceBand).not.toBeUndefined()
    expect(result.recommendedAction).not.toBe("refuse")
  })

  it("does not invent GST when gstin omitted", async () => {
    vi.mocked(searchCompanyDetailed).mockResolvedValue({
      record: null,
      source: "api",
      failureReason: "no-match",
    })

    const result = await runLookupUnknownMerchant(
      makeCtx(),
      userPolicy,
      { name: "S Creation", amount: 100 }
    )

    expect(verifyGstin).not.toHaveBeenCalled()
    expect(result.gst).toBeNull()
    expect(result.confidenceBand).toBe("low")
  })

  it("does not capture when GST is Active but MCA still misses after legal-name retry", async () => {
    const body = "27AADCB2230M1Z"
    const gstin = body + gstinCheckDigit(body)

    vi.mocked(searchCompanyDetailed).mockResolvedValue({
      record: null,
      source: "api",
      failureReason: "no-match",
    })
    vi.mocked(verifyGstin).mockResolvedValue({
      gstin,
      legalName: "ANAX IMPEX PRIVATE LIMITED",
      tradeName: "Anax Impex",
      status: "Active",
      statusNormalized: "active",
      registrationDate: "01/01/2018",
      source: "portal",
      validation: { ok: true, gstin },
    })

    const result = await runLookupUnknownMerchant(
      makeCtx(),
      userPolicy,
      { name: "Anax Impex", amount: 500, gstin }
    )

    expect(searchCompanyDetailed).toHaveBeenCalledTimes(2)
    expect(result.mcaRecord).toBeNull()
    expect(result.confidenceBand).toBe("low")
    expect(result.recommendedAction).toBe("hold")
    expect(result.effectiveAmount).toBeLessThanOrEqual(200)
  })
})
