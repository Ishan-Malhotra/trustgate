import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { getEnvValue } from "@/lib/config/env"

vi.mock("@/lib/config/env", () => ({
  getEnvValue: vi.fn(),
}))

import {
  accessTokenForSecret,
  assertControlAccess,
  CONTROL_COOKIE_NAME,
  CONTROL_SECRET_HEADER,
  getControlPlaneMode,
  isUnlocked,
  passwordMatches,
} from "@/lib/config/controlAuth"

describe("controlAuth", () => {
  const originalVercelEnv = process.env.VERCEL_ENV

  beforeEach(() => {
    vi.mocked(getEnvValue).mockReturnValue(undefined)
    delete process.env.VERCEL_ENV
  })

  afterEach(() => {
    if (originalVercelEnv === undefined) {
      delete process.env.VERCEL_ENV
    } else {
      process.env.VERCEL_ENV = originalVercelEnv
    }
  })

  it("is open locally when no secret is set", () => {
    expect(getControlPlaneMode()).toBe("open")
    expect(assertControlAccess(new Headers())).toEqual({ ok: true })
  })

  it("locks public Vercel deployments without a secret", () => {
    process.env.VERCEL_ENV = "production"
    expect(getControlPlaneMode()).toBe("locked")
    const result = assertControlAccess(new Headers())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(503)
      expect(result.code).toBe("control_locked")
    }
  })

  it("requires cookie or header when a secret is set", () => {
    vi.mocked(getEnvValue).mockReturnValue("demo-secret")
    expect(getControlPlaneMode()).toBe("password")
    const denied = assertControlAccess(new Headers())
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.status).toBe(401)
      expect(denied.code).toBe("auth_required")
    }
  })

  it("accepts the matching secret header", () => {
    vi.mocked(getEnvValue).mockReturnValue("demo-secret")
    const headers = new Headers({ [CONTROL_SECRET_HEADER]: "demo-secret" })
    expect(assertControlAccess(headers)).toEqual({ ok: true })
  })

  it("accepts the unlock cookie", () => {
    vi.mocked(getEnvValue).mockReturnValue("demo-secret")
    const token = accessTokenForSecret("demo-secret")
    const headers = new Headers({
      cookie: `${CONTROL_COOKIE_NAME}=${token}`,
    })
    expect(isUnlocked(headers, "demo-secret")).toBe(true)
    expect(assertControlAccess(headers)).toEqual({ ok: true })
  })

  it("rejects the wrong password", () => {
    expect(passwordMatches("demo-secret", "nope")).toBe(false)
    expect(passwordMatches("demo-secret", "demo-secret")).toBe(true)
  })
})
