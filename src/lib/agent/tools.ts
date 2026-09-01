import { tool } from "ai";
import { z } from "zod";
import { applyUserPolicy } from "@/lib/policy/applyUserPolicy";
import { evaluateTrust } from "@/lib/trust/evaluateTrust";
import { computeConfidence } from "@/lib/trust/confidence";
import {
  buildLiveLookupReasoningChain,
  formatReasoningChain,
} from "@/lib/trust/buildReasoningChain";
import { scoreSeller } from "@/lib/trust/scoreSeller";
import { getSellerById } from "@/lib/sellers";
import { searchCompany } from "@/lib/registry/mcaLookup";
import { sellerFromMca } from "@/lib/registry/sellerFromMca";
import { logAudit } from "@/lib/audit/logger";
import { executeApprovedPayment } from "@/lib/razorpay/executePayment";
import type { FinalDecision, Seller, SellerTrustCheck, UserPolicy } from "@/lib/types";
import type { PaymentExecutionResult } from "@/lib/razorpay/executePayment";
import { getUserPolicy } from "@/lib/config/runtimePolicy";

export interface AgentContext {
  lastDecision?: FinalDecision;
  lastExplanation?: string;
  lastPayment?: PaymentExecutionResult;
  chosenSellerId?: string;
  decisionsBySellerId: Record<string, FinalDecision>;
  trustChecks: SellerTrustCheck[];
  liveMerchants: Record<string, Seller>;
}

function resolveSeller(
  sellerId: string,
  ctx: AgentContext
): Seller | undefined {
  return getSellerById(sellerId) ?? ctx.liveMerchants[sellerId];
}

function storeTrustDecision(
  ctx: AgentContext,
  seller: Seller,
  amount: number,
  finalDecision: FinalDecision,
  options?: { liveLookup?: boolean }
) {
  ctx.lastDecision = finalDecision;
  ctx.decisionsBySellerId[seller.id] = finalDecision;
  ctx.trustChecks.push({
    sellerId: seller.id,
    sellerName: seller.name,
    amount,
    score: finalDecision.score,
    tier: finalDecision.tier,
    spendLimit: finalDecision.spendLimit,
    recommendedAction: finalDecision.action,
    trustReason: finalDecision.trustReason,
    policyReason: finalDecision.policyReason,
    confidenceLevel: finalDecision.confidenceLevel,
    confidenceBand: finalDecision.confidenceBand,
    confidenceReasons: finalDecision.confidenceReasons,
    liveLookup: options?.liveLookup,
  });
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
      const seller = getSellerById(sellerId);
      if (!seller) {
        logAudit("trust_check", `Unknown seller: ${sellerId}`);
        return { error: `Seller not found: ${sellerId}` };
      }

      const trustDecision = evaluateTrust(seller, amount);
      const finalDecision = applyUserPolicy(
        trustDecision,
        amount,
        userPolicy
      );

      storeTrustDecision(ctx, seller, amount, finalDecision);

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
        confirmThreshold: userPolicy.confirm_above_amount,
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

  const lookupUnknownMerchant = tool({
    description:
      "Look up a merchant NOT in the seed catalog via India's MCA Company Master Data registry. Use when the user names a real company that is not a seller-00x id. Returns trust + confidence assessment. MUST be called before payment for unknown merchants.",
    inputSchema: z.object({
      name: z.string().min(1),
      amount: z.number().positive(),
    }),
    execute: async ({ name, amount }) => {
      const mcaRecord = await searchCompany(name);
      const confidence = computeConfidence(mcaRecord);
      const seller = sellerFromMca(name, mcaRecord);
      const scoreResult = scoreSeller(seller);

      ctx.liveMerchants[seller.id] = seller;

      const trustDecision = evaluateTrust(seller, amount, confidence);
      const finalDecision = applyUserPolicy(
        trustDecision,
        amount,
        userPolicy
      );

      const reasoningChain = buildLiveLookupReasoningChain({
        merchantName: name,
        amount,
        mcaRecord,
        confidence,
        scoreResult,
        finalDecision,
      });

      storeTrustDecision(ctx, seller, amount, finalDecision, {
        liveLookup: true,
      });

      logAudit(
        "reasoning",
        `[live-lookup] Decision chain for ${seller.name}`,
        { sellerId: seller.id, steps: reasoningChain }
      );

      logAudit(
        "agent",
        `[live-lookup] Reasoning:\n${formatReasoningChain(reasoningChain)}`,
        { sellerId: seller.id, amount }
      );

      logAudit(
        "trust_check",
        `[live-lookup] Trust check for ${seller.name}`,
        {
          sellerId: seller.id,
          amount,
          score: finalDecision.score,
          tier: finalDecision.tier,
          spendLimit: finalDecision.spendLimit,
          action: finalDecision.action,
          confidenceLevel: finalDecision.confidenceLevel,
          confidenceBand: finalDecision.confidenceBand,
          confidenceReasons: finalDecision.confidenceReasons,
          mcaFound: Boolean(mcaRecord),
          breakdown: finalDecision.breakdown,
        }
      );

      logAudit(
        "policy_check",
        `[live-lookup] Policy applied for ${seller.name}`,
        {
          sellerId: seller.id,
          amount,
          originalAction: finalDecision.originalAction,
          finalAction: finalDecision.action,
          policyReason: finalDecision.policyReason,
        }
      );

      return {
        sellerId: seller.id,
        sellerName: seller.name,
        score: finalDecision.score,
        tier: finalDecision.tier,
        spendLimit: finalDecision.spendLimit,
        recommendedAction: finalDecision.action,
        effectiveAmount: finalDecision.effectiveAmount,
        trustReason: finalDecision.trustReason,
        policyReason: finalDecision.policyReason,
        confidenceLevel: finalDecision.confidenceLevel,
        confidenceBand: finalDecision.confidenceBand,
        confidenceReasons: finalDecision.confidenceReasons,
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
      };
    },
  });

  const authorizeOrCapture = tool({
    description:
      "Authorize or capture payment for a seller. Only call AFTER checkTrust or lookupUnknownMerchant. Never exceed spend limit.",
    inputSchema: z.object({
      sellerId: z.string(),
      amount: z.number().positive(),
      action: z.enum(["capture", "hold"]),
    }),
    execute: async ({ sellerId, amount, action }) => {
      const seller = resolveSeller(sellerId, ctx);
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
      const seller = resolveSeller(sellerId, ctx);
      const name = seller?.name ?? sellerId;
      logAudit("refusal", `Refused ${name}: ${reason}`, { sellerId, reason });
      return { refused: true, sellerId, reason };
    },
  });

  return { checkTrust, lookupUnknownMerchant, authorizeOrCapture, refuse };
}
