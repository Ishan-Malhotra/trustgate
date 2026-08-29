import { NextResponse } from "next/server";
import { z } from "zod";
import { getSellerById } from "@/lib/sellers";
import { evaluateTrust } from "@/lib/trust/evaluateTrust";
import { applyUserPolicy } from "@/lib/policy/applyUserPolicy";
import { USER_POLICY } from "@/lib/config/userPolicy";
import { generateExplanation } from "@/lib/explanation/generateExplanation";
import { logAudit, getAuditLog } from "@/lib/audit/logger";
import {
  createOrder,
  authorizeOnly,
  capturePayment,
  withRazorpayRetry,
  isRazorpayConfigured,
} from "@/lib/razorpay";

const bodySchema = z.object({
  sellerId: z.string(),
  amount: z.number().positive(),
  executePayment: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { sellerId, amount, executePayment } = parsed.data;
  const seller = getSellerById(sellerId);

  if (!seller) {
    return NextResponse.json({ error: "Seller not found" }, { status: 404 });
  }

  const trustDecision = evaluateTrust(seller, amount);
  const finalDecision = applyUserPolicy(trustDecision, amount, USER_POLICY);

  logAudit("trust_check", `Evaluated ${seller.name}`, {
    sellerId,
    amount,
    ...finalDecision,
  });

  logAudit("policy_check", `Policy for ${seller.name}`, {
    policyReason: finalDecision.policyReason,
    action: finalDecision.action,
    originalAction: finalDecision.originalAction,
  });

  const explanation = await generateExplanation(
    seller.name,
    finalDecision,
    amount
  );

  let payment: Record<string, unknown> | undefined;

  if (executePayment && finalDecision.action !== "refuse") {
    const payAmount = finalDecision.effectiveAmount;

    if (!isRazorpayConfigured()) {
      payment = {
        mode: "mock",
        status: finalDecision.action === "capture" ? "captured" : "authorized",
        amount: payAmount,
      };
      logAudit("payment", `Mock payment for ${seller.name}`, payment);
    } else {
      const receipt = `tg-eval-${sellerId}-${Date.now()}`;
      const orderResult = await withRazorpayRetry("createOrder", () =>
        createOrder(payAmount, receipt)
      );

      if (!orderResult.success) {
        logAudit("error", orderResult.error ?? "Order failed", {
          flagged: orderResult.flagged,
        });
        payment = { error: orderResult.error, flagged: orderResult.flagged };
      } else {
        const authResult = await withRazorpayRetry("authorizeOnly", () =>
          authorizeOnly(orderResult.data!.orderId, payAmount)
        );

        if (!authResult.success) {
          payment = { error: authResult.error, flagged: authResult.flagged };
        } else if (finalDecision.action === "capture") {
          const cap = await withRazorpayRetry("capturePayment", () =>
            capturePayment(authResult.data!.paymentId, payAmount)
          );
          payment = cap.success
            ? { ...cap.data, orderId: orderResult.data!.orderId }
            : { error: cap.error, flagged: cap.flagged };
        } else {
          payment = { ...authResult.data, held: true };
        }

        logAudit("payment", `Payment result for ${seller.name}`, payment);
      }
    }
  } else if (finalDecision.action === "refuse") {
    logAudit("refusal", `Refused ${seller.name}: ${explanation}`, {
      sellerId,
      amount,
    });
  }

  return NextResponse.json({
    seller,
    decision: finalDecision,
    explanation,
    payment,
    userPolicy: USER_POLICY,
    auditLog: getAuditLog(),
  });
}
