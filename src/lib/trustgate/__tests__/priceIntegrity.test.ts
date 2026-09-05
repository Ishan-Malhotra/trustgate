import { describe, it, expect } from "vitest"
import {
  checkPriceIntegrity,
  MIN_PRICE_POOL_SIZE,
} from "@/lib/trustgate/priceIntegrity"

describe("checkPriceIntegrity", () => {
  it("does not flag anomaly when pool size is below MIN_PRICE_POOL_SIZE", () => {
    const result = checkPriceIntegrity(200, [39999, 42000], { poolSize: 3 })
    expect(result.anomaly).toBe("none")
    expect(result.reason).toMatch(/insufficient|skipped|pool size/i)
    expect(MIN_PRICE_POOL_SIZE).toBe(5)
  })

  it("flags ₹200 as extreme only with a large enough peer pool", () => {
    const peers = [39999, 42000, 41000, 40500]
    const result = checkPriceIntegrity(200, peers, { poolSize: 5 })
    expect(result.anomaly).toBe("extreme")
    expect(result.referenceRange).toEqual({
      min: 39999,
      max: 42000,
    })
  })

  it("allows ₹4500 camera among peers when pool is large enough", () => {
    const peers = [5200, 6000, 5500, 5800]
    const result = checkPriceIntegrity(4500, peers, { poolSize: 5 })
    expect(result.anomaly).toBe("none")
  })

  it("skips when fewer than 4 peer prices even if poolSize claims 5", () => {
    const result = checkPriceIntegrity(200, [39999], { poolSize: 5 })
    expect(result.anomaly).toBe("none")
    expect(result.reason).toMatch(/peer/i)
  })
})
