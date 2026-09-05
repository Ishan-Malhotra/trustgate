import { createHmac, timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { getEnvValue } from "@/lib/config/env"

export const CONTROL_COOKIE_NAME = "trustgate_access"
export const CONTROL_SECRET_HEADER = "x-trustgate-secret"

export type ControlPlaneMode = "open" | "password" | "locked"

export type ControlAccessResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string; code: string }

export function getControlSecret(): string | undefined {
  return getEnvValue("TRUSTGATE_CONTROL_SECRET")
}

/** Public Vercel production/preview — local `next dev` stays open without a secret. */
export function isHardenedDeployment(): boolean {
  const env = process.env.VERCEL_ENV
  return env === "production" || env === "preview"
}

export function getControlPlaneMode(): ControlPlaneMode {
  if (getControlSecret()) return "password"
  if (isHardenedDeployment()) return "locked"
  return "open"
}

export function accessTokenForSecret(secret: string): string {
  return createHmac("sha256", secret).update("trustgate-control-v1").digest("hex")
}

export function isUnlocked(headers: Headers, secret: string): boolean {
  const header = headers.get(CONTROL_SECRET_HEADER)?.trim()
  if (header && secretsEqual(header, secret)) return true

  const cookie = readCookie(headers.get("cookie"), CONTROL_COOKIE_NAME)
  if (!cookie) return false
  return secretsEqual(cookie, accessTokenForSecret(secret))
}

export function assertControlAccess(headers: Headers): ControlAccessResult {
  const secret = getControlSecret()
  if (!secret) {
    if (isHardenedDeployment()) {
      return {
        ok: false,
        status: 503,
        error:
          "Control plane locked. Set TRUSTGATE_CONTROL_SECRET on this deployment.",
        code: "control_locked",
      }
    }
    return { ok: true }
  }

  if (isUnlocked(headers, secret)) return { ok: true }

  return {
    ok: false,
    status: 401,
    error: "auth_required",
    code: "auth_required",
  }
}

export function denyUnlessControlAccess(request: Request): NextResponse | null {
  const result = assertControlAccess(request.headers)
  if (result.ok) return null
  return NextResponse.json(
    { error: result.error, code: result.code },
    { status: result.status }
  )
}

export function passwordMatches(secret: string, password: string): boolean {
  return secretsEqual(password, secret)
}

function secretsEqual(a: string, b: string): boolean {
  const left = createHmac("sha256", "trustgate-compare").update(a).digest()
  const right = createHmac("sha256", "trustgate-compare").update(b).digest()
  return timingSafeEqual(left, right) && a.length === b.length
}

function readCookie(
  cookieHeader: string | null,
  name: string
): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    if (trimmed.slice(0, eq) === name) {
      return trimmed.slice(eq + 1)
    }
  }
  return undefined
}
