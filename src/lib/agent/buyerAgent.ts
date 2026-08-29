import { generateText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { createBuyerTools, type AgentContext } from "./tools";
import { generateExplanation } from "@/lib/explanation/generateExplanation";
import { getSellerById } from "@/lib/sellers";
import { logAudit } from "@/lib/audit/logger";

const SYSTEM_PROMPT = `You are TrustGate, an AI buyer-agent that controls payments on behalf of a user.

POLICY (strict):
1. ALWAYS call checkTrust(sellerId, amount) before any payment tool.
2. NEVER call authorizeOrCapture if checkTrust recommends refuse.
3. NEVER exceed the spend limit returned by checkTrust.
4. If checkTrust recommends "hold", call authorizeOrCapture with action "hold".
5. If checkTrust recommends "capture" and amount is within limits, call authorizeOrCapture with action "capture".
6. If checkTrust recommends "refuse" or spend limit is 0, call refuse() instead — do NOT call Razorpay.
7. Respect user policy outcomes embedded in checkTrust results.

When the user mentions a seller by name, map it to the closest seller ID from the catalog.
Amounts are in INR (₹).`;

export interface PurchaseRequestResult {
  response: string;
  explanation?: string;
  decision?: AgentContext["lastDecision"];
  auditLog: ReturnType<typeof import("@/lib/audit/logger").getAuditLog>;
}

export async function runBuyerAgent(
  userMessage: string
): Promise<PurchaseRequestResult> {
  const ctx: AgentContext = {};
  const tools = createBuyerTools(ctx);

  logAudit("agent", `User request: ${userMessage}`);

  let responseText: string;

  if (!process.env.OPENAI_API_KEY) {
    responseText =
      "OpenAI API key not configured. Use POST /api/evaluate with sellerId and amount for deterministic evaluation.";
    return {
      response: responseText,
      auditLog: (await import("@/lib/audit/logger")).getAuditLog(),
    };
  }

  const { text, steps } = await generateText({
    model: openai("gpt-4o-mini"),
    system: SYSTEM_PROMPT,
    prompt: userMessage,
    tools,
    stopWhen: stepCountIs(6),
  });

  responseText = text;

  for (const step of steps) {
    if (step.toolCalls) {
      for (const call of step.toolCalls) {
        logAudit("agent", `Tool call: ${call.toolName}`, {
          input: call.input,
        });
      }
    }
  }

  let explanation: string | undefined;
  if (ctx.lastDecision) {
    const sellerId = userMessage.match(/seller-[a-z0-9-]+/i)?.[0];
    const seller = sellerId ? getSellerById(sellerId) : undefined;
    const sellerName = seller?.name ?? "seller";
    const amountMatch = userMessage.match(/₹?\s*(\d+(?:\.\d+)?)/);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;
    explanation = await generateExplanation(sellerName, ctx.lastDecision, amount);
    ctx.lastExplanation = explanation;
  }

  return {
    response: responseText,
    explanation,
    decision: ctx.lastDecision,
    auditLog: (await import("@/lib/audit/logger")).getAuditLog(),
  };
}
