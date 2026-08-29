import { NextResponse } from "next/server";
import { z } from "zod";
import { runBuyerAgent } from "@/lib/agent/buyerAgent";

const bodySchema = z.object({
  message: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const result = await runBuyerAgent(parsed.data.message);
  return NextResponse.json(result);
}
