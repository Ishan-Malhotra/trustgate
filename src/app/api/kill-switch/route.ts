import { NextResponse } from "next/server"
import { z } from "zod"
import {
  isPaymentsKilled,
  setPaymentsKilled,
} from "@/lib/config/killSwitch"
import { denyUnlessControlAccess } from "@/lib/config/controlAuth"

const bodySchema = z.object({
  killed: z.boolean(),
})

export async function GET(request: Request) {
  const denied = denyUnlessControlAccess(request)
  if (denied) return denied

  const paymentsKilled = await isPaymentsKilled()
  return NextResponse.json({
    paymentsKilled,
    paymentsEnabled: !paymentsKilled,
  })
}

export async function PUT(request: Request) {
  const denied = denyUnlessControlAccess(request)
  if (denied) return denied

  const body = await request.json()
  const parsed = bodySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "killed boolean required" },
      { status: 400 }
    )
  }

  const paymentsKilled = await setPaymentsKilled(parsed.data.killed)
  return NextResponse.json({
    paymentsKilled,
    paymentsEnabled: !paymentsKilled,
  })
}
