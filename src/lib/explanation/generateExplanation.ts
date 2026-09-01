import { generateText } from "ai";
import type { FinalDecision, SellerTrustCheck } from "@/lib/types";
import { logAudit } from "@/lib/audit/logger";
import { getAnthropicProvider } from "@/lib/config/anthropic";

export async function generateExplanation(
  sellerName: string,
  decision: FinalDecision,
  amount: number,
  comparison: SellerTrustCheck[] = []
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
    confidenceLevel: decision.confidenceLevel,
    confidenceBand: decision.confidenceBand,
    confidenceReasons: decision.confidenceReasons,
    candidates: comparison.map((c) => ({
      seller: c.sellerName,
      amount: c.amount,
      score: c.score,
      tier: c.tier,
      action: c.recommendedAction,
      liveLookup: c.liveLookup,
      confidenceBand: c.confidenceBand,
    })),
  };

  const anthropic = getAnthropicProvider();
  if (!anthropic) {
    const fallback = buildFallbackExplanation(facts);
    logAudit("agent", `Explanation (fallback): ${fallback}`, facts);
    return fallback;
  }

  try {
    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-5"),
      system:
        "You explain TrustGate payment decisions in 1-3 short sentences. Compare candidates when more than one was evaluated (price vs trust). Be specific about scores and policy. Use ₹ for amounts. When confidence data is present, clearly separate RISK (trust score, dispute signals) from CONFIDENCE (registry verification). Say 'insufficient verifiable history' for low confidence, never 'looks risky' for that case. When high registry confidence approved a merchant with no transaction history, say registry verification drove approval — do NOT say medium trust tier caused a hold.",
      prompt: `Explain this decision: ${JSON.stringify(facts)}`,
      maxOutputTokens: 220,
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
  confidenceBand?: string;
  confidenceReasons?: string[];
  candidates?: Array<{
    seller: string;
    amount: number;
    score: number;
    tier: string;
  }>;
}): string {
  const action =
    facts.finalAction === "capture"
      ? "approved and captured"
      : facts.finalAction === "hold"
        ? "held for confirmation"
        : "refused";

  let msg = `${action}: ${facts.seller} — trust score ${facts.trustScore} (${facts.tier}), ₹${facts.amount}. ${facts.trustReason}`;
  if (facts.confidenceBand) {
    msg += ` Confidence: ${facts.confidenceBand}`;
    if (facts.confidenceReasons?.length) {
      msg += ` (${facts.confidenceReasons[0]})`;
    }
  }
  if (facts.candidates && facts.candidates.length > 1) {
    const others = facts.candidates
      .filter((c) => c.seller !== facts.seller)
      .map((c) => `${c.seller}: ₹${c.amount}, trust ${c.score} (${c.tier})`)
      .join("; ");
    if (others) {
      msg += ` Compared with ${others}.`;
    }
  }
  if (facts.policyReason) {
    msg += ` Policy: ${facts.policyReason}`;
  }
  if (facts.finalAction !== facts.originalAction) {
    msg += ` (downgraded from ${facts.originalAction})`;
  }
  return msg;
}
