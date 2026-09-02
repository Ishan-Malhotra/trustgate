import { generateText } from "ai"
import type { FinalDecision, SellerTrustCheck } from "@/lib/types"
import { logAudit } from "@/lib/audit/logger"
import { getAnthropicProvider } from "@/lib/config/anthropic"
import {
  EXPLANATION_SYSTEM_PROMPT,
  buildDeterministicExplanation,
  buildExplanationSellerFacts,
  validateExplanationText,
  type ExplanationSellerFacts,
} from "@/lib/explanation/explanationFacts"

export async function generateExplanation(
  sellerName: string,
  decision: FinalDecision,
  amount: number,
  comparison: SellerTrustCheck[] = []
): Promise<string> {
  const sellers: ExplanationSellerFacts[] = comparison.map(
    buildExplanationSellerFacts
  )

  const chosenSeller =
    sellers.find((s) => s.name === sellerName) ??
    buildExplanationSellerFacts({
      sellerId: "chosen",
      sellerName,
      amount,
      score: decision.effectiveScore,
      tier: decision.effectiveTier,
      riskScore: decision.riskScore,
      riskTier: decision.riskTier,
      effectiveScore: decision.effectiveScore,
      effectiveTier: decision.effectiveTier,
      spendLimit: decision.spendLimit,
      recommendedAction: decision.action,
      trustReason: decision.trustReason,
      policyReason: decision.policyReason,
      confidenceLevel: decision.confidenceLevel,
      confidenceBand: decision.confidenceBand,
      confidenceReasons: decision.confidenceReasons,
    })

  const payload = {
    chosenSeller,
    finalAction: decision.action,
    amount,
    policyReason: decision.policyReason,
    sellers,
  }

  const deterministic = buildDeterministicExplanation(sellerName, sellers)

  const anthropic = getAnthropicProvider()
  if (!anthropic) {
    logAudit("agent", `Explanation (fallback): ${deterministic}`, payload)
    return deterministic
  }

  try {
    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-5"),
      system: EXPLANATION_SYSTEM_PROMPT,
      prompt: `Explain this decision using ONLY each seller's pre-labeled facts:\n${JSON.stringify(payload, null, 2)}`,
      maxOutputTokens: 280,
    })

    const trimmed = text.trim()
    if (validateExplanationText(trimmed, sellers)) {
      logAudit("agent", `Explanation: ${trimmed}`, payload)
      return trimmed
    }

    logAudit(
      "agent",
      `Explanation validation failed — using deterministic summary: ${deterministic}`,
      { llmAttempt: trimmed, payload }
    )
    return deterministic
  } catch (err) {
    logAudit("error", `Explanation generation failed: ${err}`, payload)
    return deterministic
  }
}
