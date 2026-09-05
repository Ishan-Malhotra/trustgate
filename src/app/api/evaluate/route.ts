import { NextResponse } from "next/server";
import { z } from "zod";
import { getSellerById } from "@/lib/sellers";
import { evaluateTrust } from "@/lib/trust/evaluateTrust";
import { applyUserPolicy } from "@/lib/policy/applyUserPolicy";
import { getUserPolicy } from "@/lib/config/runtimePolicy";
import { generateExplanation } from "@/lib/explanation/generateExplanation";
import { logAudit, getAuditLog } from "@/lib/audit/logger";
import { executeApprovedPayment } from "@/lib/razorpay/executePayment";
import { denyUnlessControlAccess } from "@/lib/config/controlAuth";

const bodySchema = z.object({
  sellerId: z.string(),
  amount: z.number().positive(),
  executePayment: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  const denied = denyUnlessControlAccess(request);
  if (denied) return denied;

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
  const finalDecision = applyUserPolicy(trustDecision, amount, getUserPolicy());

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
    const paymentResult = await executeApprovedPayment({
      sellerId,
      sellerName: seller.name,
      amount: finalDecision.effectiveAmount,
      action: finalDecision.action,
    });
    payment = { ...paymentResult };
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
    userPolicy: getUserPolicy(),
    auditLog: getAuditLog(),
  });
}
