import { NextResponse } from "next/server";
import { z } from "zod";
import { runBuyerAgent } from "@/lib/agent/buyerAgent";
import { setUserPolicy } from "@/lib/config/runtimePolicy";

const policySchema = z.object({
  max_spend_per_transaction: z.number().positive(),
  max_spend_per_seller: z.number().positive(),
  confirm_above_amount: z.number().positive(),
  hold_expiry_seconds: z.number().positive(),
});

const bodySchema = z.object({
  message: z.string().min(1),
  userPolicy: policySchema.optional(),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const userPolicy = parsed.data.userPolicy
    ? setUserPolicy(parsed.data.userPolicy)
    : undefined;

  try {
    const result = await runBuyerAgent(parsed.data.message, userPolicy);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, flagged: true },
      { status: 500 }
    );
  }
}
