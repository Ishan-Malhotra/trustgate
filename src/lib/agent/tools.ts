import { tool } from "ai";
import { z } from "zod";
import { USER_POLICY } from "@/lib/config/userPolicy";
import { applyUserPolicy } from "@/lib/policy/applyUserPolicy";
import { evaluateTrust } from "@/lib/trust/evaluateTrust";
import { getSellerById } from "@/lib/sellers";
import { logAudit } from "@/lib/audit/logger";
import { executeApprovedPayment } from "@/lib/razorpay/executePayment";
import type { FinalDecision, SellerTrustCheck } from "@/lib/types";
import type { PaymentExecutionResult } from "@/lib/razorpay/executePayment";

export interface AgentContext {
  lastDecision?: FinalDecision;
  lastExplanation?: string;
  lastPayment?: PaymentExecutionResult;
  chosenSellerId?: string;
  decisionsBySellerId: Record<string, FinalDecision>;
  trustChecks: SellerTrustCheck[];
}

export function createBuyerTools(ctx: AgentContext) {
  const checkTrust = tool({
    description:
      "Check seller trust score and spending limit. Call on EVERY relevant seller before choosing. MUST be called before any payment action.",
    inputSchema: z.object({
      sellerId: z.string(),
      amount: z.number().positive(),
    }),
    execute: async ({ sellerId, amount }) => {
      const seller = getSellerById(sellerId);
      if (!seller) {
        logAudit("trust_check", `Unknown seller: ${sellerId}`);
        return { error: `Seller not found: ${sellerId}` };
      }

      const trustDecision = evaluateTrust(seller, amount);
      const finalDecision = applyUserPolicy(
        trustDecision,
        amount,
        USER_POLICY
      );

      ctx.lastDecision = finalDecision;
      ctx.decisionsBySellerId[sellerId] = finalDecision;
      ctx.trustChecks.push({
        sellerId,
        sellerName: seller.name,
        amount,
        score: finalDecision.score,
        tier: finalDecision.tier,
        spendLimit: finalDecision.spendLimit,
        recommendedAction: finalDecision.action,
        trustReason: finalDecision.trustReason,
        policyReason: finalDecision.policyReason,
      });

      logAudit("trust_check", `Trust check for ${seller.name}`, {
        sellerId,
        amount,
        score: finalDecision.score,
        tier: finalDecision.tier,
        spendLimit: finalDecision.spendLimit,
        action: finalDecision.action,
        breakdown: finalDecision.breakdown,
      });

      logAudit("policy_check", `Policy applied for ${seller.name}`, {
        sellerId,
        amount,
        originalAction: finalDecision.originalAction,
        finalAction: finalDecision.action,
        policyReason: finalDecision.policyReason,
        confirmThreshold: USER_POLICY.confirm_above_amount,
      });

      return {
        sellerId,
        sellerName: seller.name,
        score: finalDecision.score,
        tier: finalDecision.tier,
        spendLimit: finalDecision.spendLimit,
        recommendedAction: finalDecision.action,
        effectiveAmount: finalDecision.effectiveAmount,
        trustReason: finalDecision.trustReason,
        policyReason: finalDecision.policyReason,
      };
    },
  });

  const authorizeOrCapture = tool({
    description:
      "Authorize or capture payment for a seller. Only call AFTER checkTrust. Never exceed spend limit.",
    inputSchema: z.object({
      sellerId: z.string(),
      amount: z.number().positive(),
      action: z.enum(["capture", "hold"]),
    }),
    execute: async ({ sellerId, amount, action }) => {
      const seller = getSellerById(sellerId);
      if (!seller) {
        return { error: `Seller not found: ${sellerId}` };
      }

      const decision = ctx.decisionsBySellerId[sellerId] ?? ctx.lastDecision;
      if (!decision || decision.tier === undefined) {
        logAudit("error", "authorizeOrCapture called without prior checkTrust");
        return { error: "Must call checkTrust before payment" };
      }

      ctx.lastDecision = decision;
      ctx.chosenSellerId = sellerId;
      const payAmount = decision.effectiveAmount;

      if (decision.spendLimit !== null && amount > decision.spendLimit) {
        logAudit("refusal", `Blocked: amount exceeds spend limit`, {
          sellerId,
          amount,
          spendLimit: decision.spendLimit,
        });
        return { error: `Amount exceeds spend limit of ₹${decision.spendLimit}` };
      }

      if (decision.action === "refuse") {
        logAudit("refusal", `Blocked: trust/policy refused payment`, {
          sellerId,
          amount,
        });
        return { error: "Payment refused by trust/policy gates" };
      }

      const payment = await executeApprovedPayment({
        sellerId,
        sellerName: seller.name,
        amount: payAmount,
        action,
      });
      ctx.lastPayment = payment;

      if (payment.flagged || !payment.success) {
        return {
          error: payment.error ?? "Razorpay call failed",
          flagged: true,
          unresolved: true,
          orderId: payment.orderId,
        };
      }

      return payment;
    },
  });

  const refuse = tool({
    description: "Refuse payment with a human-readable reason. No Razorpay call.",
    inputSchema: z.object({
      sellerId: z.string(),
      reason: z.string(),
    }),
    execute: async ({ sellerId, reason }) => {
      const seller = getSellerById(sellerId);
      const name = seller?.name ?? sellerId;
      logAudit("refusal", `Refused ${name}: ${reason}`, { sellerId, reason });
      return { refused: true, sellerId, reason };
    },
  });

  return { checkTrust, authorizeOrCapture, refuse };
}
