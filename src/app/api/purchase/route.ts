import { NextResponse } from "next/server";
import { z } from "zod";
import { runBuyerAgent } from "@/lib/agent/buyerAgent";
import { setUserPolicy } from "@/lib/config/runtimePolicy";
import { userPolicySchema } from "@/lib/config/policySchema";
import {
  isPaymentsKilled,
  KILL_SWITCH_MESSAGE,
} from "@/lib/config/killSwitch";
import { getAuditLog, logAudit } from "@/lib/audit/logger";
import { denyUnlessControlAccess } from "@/lib/config/controlAuth";

const bodySchema = z.object({
  message: z.string().min(1),
  userPolicy: userPolicySchema.optional(),
});

export async function POST(request: Request) {
  const denied = denyUnlessControlAccess(request);
  if (denied) return denied;

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const userPolicy = parsed.data.userPolicy
    ? setUserPolicy(parsed.data.userPolicy)
    : undefined;

  if (isPaymentsKilled()) {
    logAudit("refusal", `[kill-switch] Stopped agent for: ${parsed.data.message}`);
    return NextResponse.json({
      response: KILL_SWITCH_MESSAGE,
      evaluatedSellers: [],
      auditLog: getAuditLog(),
      paymentsKilled: true,
    });
  }

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
