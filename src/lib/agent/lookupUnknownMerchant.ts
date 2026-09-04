import { applyUserPolicy } from "@/lib/policy/applyUserPolicy"
import { evaluateTrust } from "@/lib/trust/evaluateTrust"
import { computeConfidence } from "@/lib/trust/confidence"
import { applyGstConfidenceOverlay } from "@/lib/gst/applyGstConfidence"
import { verifyGstin, type GstTaxpayerRecord } from "@/lib/gst/verifyGstin"
import {
  buildLiveLookupReasoningChain,
  formatReasoningChain,
  formatScoreSummary,
} from "@/lib/trust/buildReasoningChain"
import {
  searchCompanyDetailed,
  type McaLookupResult,
  type MCARecord,
} from "@/lib/registry/mcaLookup"
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
  gst?: {
    gstin: string
    legalName: string | null
    status: string | null
    source: string
  } | null
  liveLookup: true
}

async function resolveMcaWithOptionalGst(
  name: string,
  gstin?: string
): Promise<{
  lookupResult: McaLookupResult
  mcaRecord: MCARecord | null
  gst: GstTaxpayerRecord | null
  mcaQueryName: string
}> {
  let lookupResult = await searchCompanyDetailed(name)
  let mcaRecord = lookupResult.record
  let gst: GstTaxpayerRecord | null = null
  let mcaQueryName = name

  if (!mcaRecord && gstin) {
    gst = await verifyGstin(gstin)
    if (gst?.legalName) {
      logAudit(
        "agent",
        `[gst] MCA miss for "${name}" — retrying MCA with GST legal name "${gst.legalName}"`,
        { tradeName: name, legalName: gst.legalName, gstin: gst.gstin }
      )
      const retry = await searchCompanyDetailed(gst.legalName)
      if (retry.record) {
        lookupResult = retry
        mcaRecord = retry.record
        mcaQueryName = gst.legalName
      }
    }
  } else if (gstin) {
    // MCA already hit — still verify GST for confidence overlay / adverse GST
    gst = await verifyGstin(gstin)
  }

  return { lookupResult, mcaRecord, gst, mcaQueryName }
}

/**
 * Existing live-merchant TrustGate path — shared by the agent tool and search_catalog.
 * MCA → optional GST bridge on miss → confidence (+ GST overlay) → evaluateTrust → policy.
 */
export async function runLookupUnknownMerchant(
  ctx: AgentContext,
  userPolicy: UserPolicy,
  input: { name: string; amount: number; gstin?: string }
): Promise<LookupUnknownMerchantResult> {
  const { name, amount, gstin } = input
  const { lookupResult, mcaRecord, gst, mcaQueryName } =
    await resolveMcaWithOptionalGst(name, gstin)

  let confidence = computeConfidence(mcaRecord)
  confidence = applyGstConfidenceOverlay(confidence, gst)

  const seller = sellerFromMca(mcaQueryName, mcaRecord)
  // Keep the trade/display name the caller used when we resolved via GST legal name
  if (mcaQueryName !== name) {
    seller.name = name
  }

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
    gst: gst
      ? {
          gstin: gst.gstin,
          source: gst.source,
          legalName: gst.legalName,
          status: gst.statusNormalized,
        }
      : null,
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
      gstin: gst?.gstin,
      gstSource: gst?.source,
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
    gst: gst
      ? {
          gstin: gst.gstin,
          legalName: gst.legalName,
          status: gst.statusNormalized,
          source: gst.source,
        }
      : null,
    liveLookup: true,
  }
}
