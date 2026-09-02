import type { FinalDecision, Seller, SellerTrustCheck } from "@/lib/types"
import type { PaymentExecutionResult } from "@/lib/razorpay/executePayment"

export interface AgentContext {
  lastDecision?: FinalDecision
  lastExplanation?: string
  lastPayment?: PaymentExecutionResult
  chosenSellerId?: string
  decisionsBySellerId: Record<string, FinalDecision>
  trustChecks: SellerTrustCheck[]
  liveMerchants: Record<string, Seller>
}

export function storeTrustDecision(
  ctx: AgentContext,
  seller: Seller,
  amount: number,
  finalDecision: FinalDecision,
  options?: { liveLookup?: boolean }
) {
  ctx.lastDecision = finalDecision
  ctx.decisionsBySellerId[seller.id] = finalDecision
  ctx.trustChecks.push({
    sellerId: seller.id,
    sellerName: seller.name,
    amount,
    score: finalDecision.score,
    tier: finalDecision.tier,
    riskScore: finalDecision.riskScore,
    riskTier: finalDecision.riskTier,
    effectiveScore: finalDecision.effectiveScore,
    effectiveTier: finalDecision.effectiveTier,
    spendLimit: finalDecision.spendLimit,
    recommendedAction: finalDecision.action,
    trustReason: finalDecision.trustReason,
    policyReason: finalDecision.policyReason,
    confidenceLevel: finalDecision.confidenceLevel,
    confidenceBand: finalDecision.confidenceBand,
    confidenceReasons: finalDecision.confidenceReasons,
    liveLookup: options?.liveLookup,
  })
}
