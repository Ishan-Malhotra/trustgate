import { tool } from "ai";
import { z } from "zod";
import { USER_POLICY } from "@/lib/config/userPolicy";
import { applyUserPolicy } from "@/lib/policy/applyUserPolicy";
import { evaluateTrust } from "@/lib/trust/evaluateTrust";
import { getSellerById } from "@/lib/sellers";
import { logAudit } from "@/lib/audit/logger";
import {
  createOrder,
  authorizeOnly,
  capturePayment,
  withRazorpayRetry,
  isRazorpayConfigured,
} from "@/lib/razorpay";
import type { FinalDecision } from "@/lib/types";

export interface AgentContext {
  lastDecision?: FinalDecision;
  lastExplanation?: string;
}

export function createBuyerTools(ctx: AgentContext) {
  const checkTrust = tool({
    description:
      "Check seller trust score and spending limit. MUST be called before any payment action.",
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

      if (!ctx.lastDecision || ctx.lastDecision.tier === undefined) {
        logAudit("error", "authorizeOrCapture called without prior checkTrust");
        return { error: "Must call checkTrust before payment" };
      }

      const decision = ctx.lastDecision;
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

      if (!isRazorpayConfigured()) {
        const mockResult = {
          mode: "mock",
          orderId: `order_mock_${Date.now()}`,
          paymentId: `pay_mock_${Date.now()}`,
          action,
          amount: payAmount,
          status: action === "capture" ? "captured" : "authorized",
        };
        logAudit("payment", `Mock ${action} for ${seller.name}`, mockResult);
        return mockResult;
      }

      const receipt = `tg-${sellerId}-${Date.now()}`;
      const orderResult = await withRazorpayRetry("createOrder", () =>
        createOrder(payAmount, receipt)
      );

      if (!orderResult.success || !orderResult.data) {
        logAudit("error", `Order creation failed: ${orderResult.error}`, {
          flagged: orderResult.flagged,
        });
        return { error: orderResult.error, flagged: orderResult.flagged };
      }

      const authResult = await withRazorpayRetry("authorizeOnly", () =>
        authorizeOnly(orderResult.data!.orderId, payAmount)
      );

      if (!authResult.success || !authResult.data) {
        logAudit("error", `Authorization failed: ${authResult.error}`, {
          flagged: authResult.flagged,
        });
        return { error: authResult.error, flagged: authResult.flagged };
      }

      if (action === "capture" && decision.action === "capture") {
        const captureResult = await withRazorpayRetry("capturePayment", () =>
          capturePayment(authResult.data!.paymentId, payAmount)
        );

        if (!captureResult.success) {
          logAudit("error", `Capture failed: ${captureResult.error}`, {
            flagged: captureResult.flagged,
          });
          return { error: captureResult.error, flagged: captureResult.flagged };
        }

        logAudit("payment", `Captured payment for ${seller.name}`, {
          ...captureResult.data,
          orderId: orderResult.data.orderId,
        });
        return { ...captureResult.data, orderId: orderResult.data.orderId };
      }

      logAudit("payment", `Authorized (hold) for ${seller.name}`, {
        ...authResult.data,
        orderId: orderResult.data.orderId,
      });
      return { ...authResult.data, orderId: orderResult.data.orderId, held: true };
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
