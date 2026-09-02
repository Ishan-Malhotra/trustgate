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
      "Look up a merchant NOT in the seed catalog via India's MCA Company Master Data registry. Use when the user names a real company that is not a seller-00x id. Returns trust + confidence assessment. MUST be called before payment for unknown merchants.",
    inputSchema: z.object({
      name: z.string().min(1),
      amount: z.number().positive(),
    }),
    execute: async ({ name, amount }) =>
      runLookupUnknownMerchant(ctx, userPolicy, { name, amount }),
  })

  const search_catalog = tool({
    description:
      "Search external catalog providers (IndiaMART first) for a PRODUCT goal not covered by the seed catalog. Finds candidate deals, asks TrustGate to verify each merchant, and ranks TrustGate-approved candidates by price. Does not invent trust. Use instead of forcing a seed-catalog mismatch.",
    inputSchema: z.object({
      query: z.string().min(1),
      budget: z.number().positive().optional(),
    }),
    execute: async ({ query, budget }) =>
      runShoppingAgent({ query, budget }, ctx, userPolicy),
  })

  const authorizeOrCapture = tool({
    description:
      "Authorize or capture payment for a seller. Only call AFTER checkTrust, lookupUnknownMerchant, or search_catalog. Never exceed spend limit.",
    inputSchema: z.object({
      sellerId: z.string(),
      amount: z.number().positive(),
      action: z.enum(["capture", "hold"]),
    }),
    execute: async ({ sellerId, amount, action }) => {
      const seller = resolveSeller(sellerId, ctx)
      if (!seller) {
        return { error: `Seller not found: ${sellerId}` }
      }

      const decision = ctx.decisionsBySellerId[sellerId] ?? ctx.lastDecision
      if (!decision || decision.tier === undefined) {
        logAudit("error", "authorizeOrCapture called without prior checkTrust")
        return { error: "Must call checkTrust before payment" }
      }

      ctx.lastDecision = decision
      ctx.chosenSellerId = sellerId
      const payAmount = decision.effectiveAmount

      if (decision.spendLimit !== null && amount > decision.spendLimit) {
        logAudit("refusal", `Blocked: amount exceeds spend limit`, {
          sellerId,
          amount,
          spendLimit: decision.spendLimit,
        })
        return { error: `Amount exceeds spend limit of ₹${decision.spendLimit}` }
      }

      if (decision.action === "refuse") {
        logAudit("refusal", `Blocked: trust/policy refused payment`, {
          sellerId,
          amount,
        })
        return { error: "Payment refused by trust/policy gates" }
      }

      const payment = await executeApprovedPayment({
        sellerId,
        sellerName: seller.name,
        amount: payAmount,
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
