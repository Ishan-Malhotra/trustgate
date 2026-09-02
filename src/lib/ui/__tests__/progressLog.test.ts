import { describe, it, expect } from "vitest"
import { formatProgressEntry } from "@/lib/ui/progressLog"
import type { AuditEntry } from "@/lib/types"

function makeEntry(
  type: AuditEntry["type"],
  message: string
): AuditEntry {
  return {
    id: "test",
    timestamp: "2026-09-03T00:00:00.000Z",
    type,
    message,
  }
}

describe("formatProgressEntry", () => {
  it("replaces [live-lookup] on live trust checks", () => {
    const entry = makeEntry(
      "trust_check",
      "[live-lookup] Trust check for Infosys Limited"
    )
    expect(formatProgressEntry(entry)).toBe(
      "TrustGate: Trust check for Infosys Limited"
    )
  })

  it("replaces [live-lookup] on live policy checks", () => {
    const entry = makeEntry(
      "policy_check",
      "[live-lookup] Policy applied for Infosys Limited"
    )
    expect(formatProgressEntry(entry)).toBe(
      "Policy: Policy applied for Infosys Limited"
    )
  })

  it("prefixes seed-catalog policy checks that have no live-lookup tag", () => {
    const entry = makeEntry("policy_check", "Policy applied for Blue Bottle")
    expect(formatProgressEntry(entry)).toBe("Policy: Policy applied for Blue Bottle")
  })

  it("leaves seed-catalog trust checks without a live-lookup rewrite", () => {
    const entry = makeEntry("trust_check", "Trust check for Blue Bottle")
    expect(formatProgressEntry(entry)).toBe("Trust check for Blue Bottle")
  })
})
