import { tool } from "ai"
import { z } from "zod"
import { applyUserPolicy } from "@/lib/policy/applyUserPolicy"
import { evaluateTrust } from "@/lib/trust/evaluateTrust"
import { getSellerById } from "@/lib/sellers"
import { logAudit } from "@/lib/audit/logger"
import { executeApprovedPayment } from "@/lib/razorpay/executePayment"
import type { UserPolicy } from "@/lib/types"
import { getUserPolicy } from "@/lib/config/runtimePolicy"
import { runLookupUnknownMerchant } from "@/lib/agent/lookupUnknownMerchant"
import { runShoppingAgent } from "@/lib/agent/shoppingAgent"
import { assertPaymentAuthorized } from "@/lib/agent/assertPaymentAuthorized"
import { assertPaymentsAllowed } from "@/lib/config/killSwitch"
import {
  storeTrustDecision,
  type AgentContext,
} from "@/lib/agent/context"

export type { AgentContext } from "@/lib/agent/context"

function resolveSeller(sellerId: string, ctx: AgentContext) {
  return getSellerById(sellerId) ?? ctx.liveMerchants[sellerId]
}

export function createBuyerTools(
  ctx: AgentContext,
  userPolicy: UserPolicy = getUserPolicy()
) {
  const checkTrust = tool({
    description:
      "Check seller trust score and spending limit. Call on EVERY relevant seed-catalog seller before choosing. MUST be called before any payment action.",
    inputSchema: z.object({
      sellerId: z.string(),
      amount: z.number().positive(),
    }),
    execute: async ({ sellerId, amount }) => {
      const seller = getSellerById(sellerId)
      if (!seller) {
        logAudit("trust_check", `Unknown seller: ${sellerId}`)
        return { error: `Seller not found: ${sellerId}` }
      }

      const trustDecision = evaluateTrust(seller, amount)
      const finalDecision = applyUserPolicy(
        trustDecision,
        amount,
        userPolicy
      )

      storeTrustDecision(ctx, seller, amount, finalDecision)

      logAudit("trust_check", `Trust check for ${seller.name}`, {
        sellerId,
        amount,
        score: finalDecision.score,
        tier: finalDecision.tier,
        riskScore: finalDecision.riskScore,
        riskTier: finalDecision.riskTier,
        effectiveScore: finalDecision.effectiveScore,
        effectiveTier: finalDecision.effectiveTier,
        spendLimit: finalDecision.spendLimit,
        action: finalDecision.action,
        breakdown: finalDecision.breakdown,
      })

      logAudit("policy_check", `Policy applied for ${seller.name}`, {
        sellerId,
        amount,
        originalAction: finalDecision.originalAction,
        finalAction: finalDecision.action,
        policyReason: finalDecision.policyReason,
        confirmThreshold: userPolicy.confirm_above_amount,
      })

      return {
        sellerId,
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
      }
    },
  })

  const lookupUnknownMerchant = tool({
    description:
      "Look up a merchant NOT in the seed catalog via India's MCA Company Master Data registry. Optionally pass gstin when known — TrustGate validates GST and may retry MCA with the GST legal name if the trade name misses. Returns trust + confidence assessment. MUST be called before payment for unknown merchants.",
    inputSchema: z.object({
      name: z.string().min(1),
      amount: z.number().positive(),
      gstin: z.string().min(15).max(15).optional(),
    }),
    execute: async ({ name, amount, gstin }) =>
      runLookupUnknownMerchant(ctx, userPolicy, { name, amount, gstin }),
  })

  const search_catalog = tool({
    description:
      "Search external catalog providers (IndiaMART first) for a PRODUCT goal not covered by the seed catalog. Finds candidates; TrustGate runs product/price integrity then seller checks; ranks CAPTURE-first by price. May include shoppingReliability warnings. Returns status: authorized (may pay capture), requires_confirmation (HOLD recommendation — do NOT auto-pay), no_viable, or no_suppliers. Does not invent trust. Use instead of forcing a seed-catalog mismatch.",
    inputSchema: z.object({
      query: z.string().min(1),
      budget: z.number().positive().optional(),
    }),
    execute: async ({ query, budget }) =>
      runShoppingAgent({ query, budget }, ctx, userPolicy),
  })

  const authorizeOrCapture = tool({
    description:
      "Authorize or capture payment for a seller. Only call AFTER checkTrust, lookupUnknownMerchant, or search_catalog with status authorized. Action MUST match the stored TrustGate decision for that sellerId (capture cannot override hold). Never call for catalog status requires_confirmation. Never exceed spend limit.",
    inputSchema: z.object({
      sellerId: z.string(),
      amount: z.number().positive(),
      action: z.enum(["capture", "hold"]),
    }),
    execute: async ({ sellerId, amount, action }) => {
      const kill = assertPaymentsAllowed()
      if (!kill.ok) {
        logAudit("refusal", `[kill-switch] Blocked authorizeOrCapture`, {
          sellerId,
          amount,
          action,
        })
        return { error: kill.error, paymentsKilled: true }
      }

      const seller = resolveSeller(sellerId, ctx)
      if (!seller) {
        return { error: `Seller not found: ${sellerId}` }
      }

      const decision = ctx.decisionsBySellerId[sellerId]
      const gate = assertPaymentAuthorized({
        sellerId,
        amount,
        action,
        decision,
        shoppingStatus: ctx.lastShoppingStatus,
        shoppingChosenSellerId: ctx.lastShoppingChosenSellerId,
        shoppingCatalogSellerIds: ctx.lastShoppingSellerIds,
      })
      if (!gate.ok) {
        logAudit("refusal", `[payment-gate] ${gate.error}`, {
          sellerId,
          amount,
          action,
          storedAction: decision?.action,
          shoppingStatus: ctx.lastShoppingStatus,
        })
        return { error: gate.error }
      }

      if (!decision) {
        return { error: "Must check trust for this seller before payment" }
      }

      ctx.lastDecision = decision
      ctx.chosenSellerId = sellerId

      const payment = await executeApprovedPayment({
        sellerId,
        sellerName: seller.name,
        amount: gate.payAmount,
        action,
      })
      ctx.lastPayment = payment

      if (payment.flagged || !payment.success) {
        return {
          error: payment.error ?? "Razorpay call failed",
          flagged: true,
          unresolved: true,
          orderId: payment.orderId,
        }
      }

      return payment
    },
  })

  const refuse = tool({
    description: "Refuse payment with a human-readable reason. No Razorpay call.",
    inputSchema: z.object({
      sellerId: z.string(),
      reason: z.string(),
    }),
    execute: async ({ sellerId, reason }) => {
      const seller = resolveSeller(sellerId, ctx)
      const name = seller?.name ?? sellerId
      logAudit("refusal", `Refused ${name}: ${reason}`, { sellerId, reason })
      return { refused: true, sellerId, reason }
    },
  })

  return {
    checkTrust,
    lookupUnknownMerchant,
    search_catalog,
    authorizeOrCapture,
    refuse,
  }
}
