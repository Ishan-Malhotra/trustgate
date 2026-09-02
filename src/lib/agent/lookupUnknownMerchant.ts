import { applyUserPolicy } from "@/lib/policy/applyUserPolicy"
import { evaluateTrust } from "@/lib/trust/evaluateTrust"
import { computeConfidence } from "@/lib/trust/confidence"
import {
  buildLiveLookupReasoningChain,
  formatReasoningChain,
  formatScoreSummary,
} from "@/lib/trust/buildReasoningChain"
import { searchCompanyDetailed } from "@/lib/registry/mcaLookup"
import { sellerFromMca } from "@/lib/registry/sellerFromMca"
import { logAudit } from "@/lib/audit/logger"
import type { FinalDecision, UserPolicy } from "@/lib/types"
import { storeTrustDecision, type AgentContext } from "@/lib/agent/context"

export interface LookupUnknownMerchantResult {
  sellerId: string
  sellerName: string
  score: number
  tier: FinalDecision["tier"]
  riskScore: number
  riskTier: FinalDecision["tier"]
  effectiveScore: number
  effectiveTier: FinalDecision["tier"]
  spendLimit: number | null
  recommendedAction: FinalDecision["action"]
  effectiveAmount: number
  trustReason: string
  policyReason?: string
  confidenceLevel?: number
  confidenceBand?: "high" | "medium" | "low"
  confidenceReasons?: string[]
  lookupFailureReason?: string
  lookupSource: string
  reasoningChain: ReturnType<typeof buildLiveLookupReasoningChain>
  mcaRecord: {
    cin: string
    companyName: string
    status: string
    registrationDate: string | null
    paidupCapital: number
    state: string
  } | null
  liveLookup: true
}

/**
 * Existing live-merchant TrustGate path — shared by the agent tool and search_catalog.
 * Behavior unchanged: MCA → confidence → evaluateTrust → applyUserPolicy.
 */
export async function runLookupUnknownMerchant(
  ctx: AgentContext,
  userPolicy: UserPolicy,
  input: { name: string; amount: number }
): Promise<LookupUnknownMerchantResult> {
  const { name, amount } = input
  const lookupResult = await searchCompanyDetailed(name)
  const mcaRecord = lookupResult.record
  const confidence = computeConfidence(mcaRecord)
  const seller = sellerFromMca(name, mcaRecord)

  ctx.liveMerchants[seller.id] = seller

  const trustDecision = evaluateTrust(seller, amount, confidence)
  const finalDecision = applyUserPolicy(trustDecision, amount, userPolicy)

  const reasoningChain = buildLiveLookupReasoningChain({
    merchantName: name,
    amount,
    mcaRecord,
    lookupResult,
    confidence,
    finalDecision,
  })

  storeTrustDecision(ctx, seller, amount, finalDecision, {
    liveLookup: true,
  })

  logAudit("reasoning", `[live-lookup] Decision chain for ${seller.name}`, {
    sellerId: seller.id,
    steps: reasoningChain,
  })

  logAudit(
    "agent",
    `[live-lookup] Reasoning:\n${formatReasoningChain(reasoningChain)}`,
    { sellerId: seller.id, amount }
  )

  const scoreSummary = formatScoreSummary(finalDecision)

  logAudit(
    "trust_check",
    `[live-lookup] Trust check for ${seller.name} — ${scoreSummary}`,
    {
      sellerId: seller.id,
      amount,
      score: finalDecision.score,
      tier: finalDecision.tier,
      riskScore: finalDecision.riskScore,
      riskTier: finalDecision.riskTier,
      effectiveScore: finalDecision.effectiveScore,
      effectiveTier: finalDecision.effectiveTier,
      spendLimit: finalDecision.spendLimit,
      action: finalDecision.action,
      confidenceLevel: finalDecision.confidenceLevel,
      confidenceBand: finalDecision.confidenceBand,
      confidenceReasons: finalDecision.confidenceReasons,
      mcaFound: Boolean(mcaRecord),
      lookupSource: lookupResult.source,
      lookupFailureReason: lookupResult.failureReason,
      breakdown: finalDecision.breakdown,
    }
  )

  logAudit("policy_check", `[live-lookup] Policy applied for ${seller.name}`, {
    sellerId: seller.id,
    amount,
    originalAction: finalDecision.originalAction,
    finalAction: finalDecision.action,
    policyReason: finalDecision.policyReason,
  })

  return {
    sellerId: seller.id,
    sellerName: seller.name,
    score: finalDecision.score,
    tier: finalDecision.tier,
    riskScore: finalDecision.riskScore,
    riskTier: finalDecision.riskTier,
    effectiveScore: finalDecision.effectiveScore,
    effectiveTier: finalDecision.effectiveTier,
    spendLimit: finalDecision.spendLimit,
    recommendedAction: finalDecision.action,
    effectiveAmount: finalDecision.effectiveAmount,
    trustReason: finalDecision.trustReason,
    policyReason: finalDecision.policyReason,
    confidenceLevel: finalDecision.confidenceLevel,
    confidenceBand: finalDecision.confidenceBand,
    confidenceReasons: finalDecision.confidenceReasons,
    lookupFailureReason: lookupResult.failureReason,
    lookupSource: lookupResult.source,
    reasoningChain,
    mcaRecord: mcaRecord
      ? {
          cin: mcaRecord.cin,
          companyName: mcaRecord.companyName,
          status: mcaRecord.status,
          registrationDate: mcaRecord.registrationDate,
          paidupCapital: mcaRecord.paidupCapital,
          state: mcaRecord.state,
        }
      : null,
    liveLookup: true,
  }
}
