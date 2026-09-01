import { generateText, stepCountIs } from "ai";
import { createBuyerTools, type AgentContext } from "./tools";
import { generateExplanation } from "@/lib/explanation/generateExplanation";
import { getAllSellers, getSellerById } from "@/lib/sellers";
import { logAudit, getAuditLog } from "@/lib/audit/logger";
import { getAnthropicProvider, missingAnthropicConfigMessage } from "@/lib/config/anthropic";
import type { UserPolicy } from "@/lib/types";
import type { PaymentExecutionResult } from "@/lib/razorpay/executePayment";
import { getUserPolicy } from "@/lib/config/runtimePolicy";

function buildSystemPrompt(): string {
  const catalog = getAllSellers()
    .map((s) => {
      const known = s.known_for?.length
        ? `; known for: ${s.known_for.join(", ")}`
        : "";
      const listings = s.listings?.length
        ? `; listings: ${s.listings.map((l) => `${l.item} ₹${l.price}`).join(", ")}`
        : "";
      return `- ${s.id}: ${s.name} (${s.category}${known}${listings})`;
    })
    .join("\n");

  return `You are TrustGate, an AI buyer-agent that controls payments on behalf of a user.

Requests are GOAL-based (item + optional constraints). Do not treat a named seller as a skip-the-comparison shortcut.

HOW TO BUY:
1. Filter the catalog to every seller whose category, known-for, or listings match the goal.
2. Call checkTrust on EACH relevant seller (usually 2+). Use that seller's matching listing price as amount unless the user set a budget.
3. Compare trust tier, listing price, spend limit, and user policy together. Do not pick on price alone.
4. Choose one seller, or refuse the request if none clear the trust bar.
5. Your final message MUST explain the tradeoff (e.g. "A was ₹50 cheaper but medium trust with rising disputes; chose B").

POLICY (strict):
1. ALWAYS call checkTrust(sellerId, amount) before any payment tool for that seller.
2. NEVER call authorizeOrCapture if that seller's checkTrust recommends refuse.
3. NEVER exceed the spend limit returned by checkTrust.
4. If the chosen seller's checkTrust recommends "hold", call authorizeOrCapture with action "hold".
5. If it recommends "capture" and amount is within limits, call authorizeOrCapture with action "capture".
6. If all relevant sellers are refuse / spend limit 0, call refuse() — do NOT call Razorpay.
7. Respect user policy outcomes embedded in checkTrust results (e.g. confirm_above_amount hold).

Seller catalog (public listings only — trust is unknown until checkTrust):
${catalog}

Amounts are in INR (₹).

LIVE MERCHANT LOOKUP (merchants NOT in the catalog above):
- If the user names a specific real company that is NOT a seller-00x id, call lookupUnknownMerchant(name, amount) instead of checkTrust.
- Never invent a seed seller id for an unknown merchant.
- Never refuse solely because a merchant is "new to us" — use the confidence assessment from lookupUnknownMerchant.
- Follow recommendedAction from lookupUnknownMerchant exactly (capture vs hold vs refuse). High MCA confidence can approve capture even when risk score is medium due to missing transaction history — that is expected, not a reason to hold.
- Distinguish in your explanation: "insufficient verifiable history" (low confidence) vs "signals look bad" (high risk / adverse registry).`;
}

export interface PurchaseRequestResult {
  response: string;
  explanation?: string;
  decision?: AgentContext["lastDecision"];
  payment?: PaymentExecutionResult;
  evaluatedSellers: AgentContext["trustChecks"];
  chosenSellerId?: string;
  auditLog: ReturnType<typeof getAuditLog>;
}

export async function runBuyerAgent(
  userMessage: string,
  userPolicy?: UserPolicy
): Promise<PurchaseRequestResult> {
  const activePolicy = userPolicy ?? getUserPolicy();
  const ctx: AgentContext = {
    decisionsBySellerId: {},
    trustChecks: [],
    liveMerchants: {},
  };
  const tools = createBuyerTools(ctx, activePolicy);

  logAudit("agent", `User request: ${userMessage}`);

  const anthropic = getAnthropicProvider();
  if (!anthropic) {
    const message = missingAnthropicConfigMessage();
    logAudit("error", message);
    return {
      response: message,
      evaluatedSellers: [],
      auditLog: getAuditLog(),
    };
  }
  let responseText: string;

  try {
    const { text, steps } = await generateText({
      model: anthropic("claude-sonnet-4-5"),
      system: buildSystemPrompt(),
      prompt: userMessage,
      tools,
      stopWhen: stepCountIs(16),
    });

    responseText = text;

    if (responseText.trim()) {
      logAudit("reasoning", "Agent conclusion", {
        response: responseText.trim(),
      });
    }

    for (const step of steps) {
      if (step.toolCalls) {
        for (const call of step.toolCalls) {
          logAudit("agent", `Tool call: ${call.toolName}`, {
            input: call.input,
          });
        }
      }
      if (step.toolResults) {
        for (const result of step.toolResults) {
          logAudit("reasoning", `Tool result: ${result.toolName}`, {
            output: result.output,
          });
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logAudit("error", `Buyer agent failed: ${message}`);
    const workspaceHint = message.includes("anthropic-workspace-id")
      ? missingAnthropicConfigMessage()
      : `Agent error: ${message}`;
    return {
      response: workspaceHint,
      decision: ctx.lastDecision,
      payment: ctx.lastPayment,
      evaluatedSellers: ctx.trustChecks,
      chosenSellerId: ctx.chosenSellerId,
      auditLog: getAuditLog(),
    };
  }

  let explanation: string | undefined;
  if (ctx.lastDecision) {
    const chosenId = ctx.chosenSellerId;
    const chosenSeller = chosenId
      ? (getSellerById(chosenId) ?? ctx.liveMerchants[chosenId])
      : undefined;
    const chosenCheck = chosenId
      ? ctx.trustChecks.find((c) => c.sellerId === chosenId)
      : ctx.trustChecks[ctx.trustChecks.length - 1];
    const sellerName = chosenSeller?.name ?? chosenCheck?.sellerName ?? "seller";
    const amount = chosenCheck?.amount ?? ctx.lastDecision.effectiveAmount;
    explanation = await generateExplanation(
      sellerName,
      ctx.lastDecision,
      amount,
      ctx.trustChecks
    );
    ctx.lastExplanation = explanation;
  }

  return {
    response: responseText,
    explanation,
    decision: ctx.lastDecision,
    payment: ctx.lastPayment,
    evaluatedSellers: ctx.trustChecks,
    chosenSellerId: ctx.chosenSellerId,
    auditLog: getAuditLog(),
  };
}
