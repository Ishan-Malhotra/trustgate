import { NextResponse } from "next/server"
import { z } from "zod"
import {
  accessTokenForSecret,
  CONTROL_COOKIE_NAME,
  getControlPlaneMode,
  getControlSecret,
  isHardenedDeployment,
  isUnlocked,
  passwordMatches,
} from "@/lib/config/controlAuth"

const bodySchema = z.object({
  password: z.string().min(1),
})

export async function GET(request: Request) {
  const mode = getControlPlaneMode()
  const secret = getControlSecret()
  const unlocked =
    mode === "open" || (secret ? isUnlocked(request.headers, secret) : false)

  return NextResponse.json({
    mode,
    unlocked,
    hardened: isHardenedDeployment(),
  })
}

export async function POST(request: Request) {
  const secret = getControlSecret()
  const mode = getControlPlaneMode()

  if (!secret) {
    if (mode === "locked") {
      return NextResponse.json(
        {
          error:
            "Control plane locked. Set TRUSTGATE_CONTROL_SECRET on this deployment.",
          code: "control_locked",
        },
        { status: 503 }
      )
    }
    return NextResponse.json({ mode: "open", unlocked: true })
  }

  const body = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "password required", code: "auth_required" },
      { status: 400 }
    )
  }

  if (!passwordMatches(secret, parsed.data.password)) {
    return NextResponse.json(
      { error: "Invalid password", code: "auth_failed" },
      { status: 401 }
    )
  }

  const response = NextResponse.json({ mode: "password", unlocked: true })
  response.cookies.set({
    name: CONTROL_COOKIE_NAME,
    value: accessTokenForSecret(secret),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
    secure: isHardenedDeployment(),
  })
  return response
}
