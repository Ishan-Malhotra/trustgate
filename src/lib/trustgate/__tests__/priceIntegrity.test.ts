import { describe, it, expect } from "vitest"
import { checkPriceIntegrity } from "@/lib/trustgate/priceIntegrity"

describe("checkPriceIntegrity", () => {
  it("flags ₹200 PS5 as extreme vs ₹39999/₹42000 peers", () => {
    const result = checkPriceIntegrity(200, [39999, 42000])
    expect(result.anomaly).toBe("extreme")
    expect(result.referenceRange).toEqual({ min: 39999, max: 42000 })
  })

  it("allows ₹4500 camera among ₹5200/₹6000 peers", () => {
    const result = checkPriceIntegrity(4500, [5200, 6000])
    expect(result.anomaly).toBe("none")
  })

  it("does not invent market price with fewer than 2 peers", () => {
    const result = checkPriceIntegrity(200, [39999])
    expect(result.anomaly).toBe("none")
  })
})
