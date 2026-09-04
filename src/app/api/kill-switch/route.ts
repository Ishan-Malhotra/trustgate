import { NextResponse } from "next/server"
import { z } from "zod"
import {
  isPaymentsKilled,
  setPaymentsKilled,
} from "@/lib/config/killSwitch"

const bodySchema = z.object({
  killed: z.boolean(),
})

export async function GET() {
  return NextResponse.json({
    paymentsKilled: isPaymentsKilled(),
    paymentsEnabled: !isPaymentsKilled(),
  })
}

export async function PUT(request: Request) {
  const body = await request.json()
  const parsed = bodySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "killed boolean required" },
      { status: 400 }
    )
  }

  const paymentsKilled = setPaymentsKilled(parsed.data.killed)
  return NextResponse.json({
    paymentsKilled,
    paymentsEnabled: !paymentsKilled,
  })
}
