import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { FinalDecision } from "@/lib/types";
import { logAudit } from "@/lib/audit/logger";
import { getAnthropicApiKey } from "@/lib/config/env";

export async function generateExplanation(
  sellerName: string,
  decision: FinalDecision,
  amount: number
): Promise<string> {
  const facts = {
    seller: sellerName,
    amount,
    trustScore: decision.score,
    tier: decision.tier,
    trustReason: decision.trustReason,
    policyReason: decision.policyReason,
    finalAction: decision.action,
    originalAction: decision.originalAction,
    spendLimit: decision.spendLimit,
  };

  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    const fallback = buildFallbackExplanation(facts);
    logAudit("agent", `Explanation (fallback): ${fallback}`, facts);
    return fallback;
  }

  try {
    const anthropic = createAnthropic({ apiKey });
    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-5"),
      system:
        "You explain TrustGate payment decisions in one short sentence. Be specific about trust score and policy. Use ₹ for amounts.",
      prompt: `Explain this decision: ${JSON.stringify(facts)}`,
      maxOutputTokens: 120,
    });

    logAudit("agent", `Explanation: ${text}`, facts);
    return text.trim();
  } catch (err) {
    const fallback = buildFallbackExplanation(facts);
    logAudit("error", `Explanation generation failed: ${err}`, facts);
    return fallback;
  }
}

function buildFallbackExplanation(facts: {
  seller: string;
  amount: number;
  trustScore: number;
  tier: string;
  trustReason: string;
  policyReason?: string;
  finalAction: string;
  originalAction: string;
}): string {
  const action =
    facts.finalAction === "capture"
      ? "approved and captured"
      : facts.finalAction === "hold"
        ? "held for confirmation"
        : "refused";

  let msg = `${action}: ${facts.seller} — trust score ${facts.trustScore} (${facts.tier}), ₹${facts.amount}. ${facts.trustReason}`;
  if (facts.policyReason) {
    msg += ` Policy: ${facts.policyReason}`;
  }
  if (facts.finalAction !== facts.originalAction) {
    msg += ` (downgraded from ${facts.originalAction})`;
  }
  return msg;
}
