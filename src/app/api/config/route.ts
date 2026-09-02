import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getUserPolicy,
  resetUserPolicy,
  setUserPolicy,
} from "@/lib/config/runtimePolicy";

const policySchema = z.object({
  max_spend_per_transaction: z.number().positive(),
  max_spend_per_seller: z.number().positive(),
  confirm_above_amount: z.number().positive(),
  hold_expiry_seconds: z.number().positive(),
});

export async function GET() {
  return NextResponse.json({ userPolicy: getUserPolicy() });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const parsed = policySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid policy", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const userPolicy = setUserPolicy(parsed.data);
  return NextResponse.json({ userPolicy });
}

export async function DELETE() {
  const userPolicy = resetUserPolicy();
  return NextResponse.json({ userPolicy });
}
