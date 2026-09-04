import { describe, it, expect, beforeEach } from "vitest"
import {
  assertPaymentsAllowed,
  isPaymentsKilled,
  KILL_SWITCH_MESSAGE,
  setPaymentsKilled,
} from "@/lib/config/killSwitch"

describe("killSwitch", () => {
  beforeEach(() => {
    setPaymentsKilled(false)
  })

  it("defaults to payments enabled", () => {
    expect(isPaymentsKilled()).toBe(false)
    expect(assertPaymentsAllowed()).toEqual({ ok: true })
  })

  it("blocks payments when engaged", () => {
    setPaymentsKilled(true)
    expect(isPaymentsKilled()).toBe(true)
    expect(assertPaymentsAllowed()).toEqual({
      ok: false,
      error: KILL_SWITCH_MESSAGE,
    })
  })

  it("re-enables payments when released", () => {
    setPaymentsKilled(true)
    setPaymentsKilled(false)
    expect(isPaymentsKilled()).toBe(false)
    expect(assertPaymentsAllowed().ok).toBe(true)
  })
})
