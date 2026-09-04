import { describe, it, expect } from "vitest"
import { checkProductIntegrity } from "@/lib/trustgate/productIntegrity"
import type { AgentProposal } from "@/lib/trustgate/agentProposal"

function proposal(productName: string | null, price = 100): AgentProposal {
  return {
    productName,
    price,
    seller: "Test Seller",
    source: "indiamart",
  }
}

describe("checkProductIntegrity", () => {
  it("refuses PS5 controller cover for PS5 request", () => {
    const result = checkProductIntegrity(
      "Buy me a PS5",
      proposal("PS5 Controller Cover")
    )
    expect(result.match).toBe(false)
    expect(result.reason).toMatch(/mismatch|accessory/i)
  })

  it("refuses camera lens cap for camera request", () => {
    const result = checkProductIntegrity(
      "Buy me a camera",
      proposal("Camera Lens Cap")
    )
    expect(result.match).toBe(false)
  })

  it("accepts Sony PlayStation 5 Console for PS5 request", () => {
    const result = checkProductIntegrity(
      "Buy me a PS5",
      proposal("Sony PlayStation 5 Console")
    )
    expect(result.match).toBe(true)
  })

  it("refuses missing product title", () => {
    const result = checkProductIntegrity("Buy me a PS5", proposal(null))
    expect(result.match).toBe(false)
    expect(result.found).toMatch(/missing/i)
  })
})
