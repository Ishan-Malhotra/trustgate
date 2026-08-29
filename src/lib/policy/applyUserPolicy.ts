import type { FinalDecision, TrustDecision, UserPolicy } from "@/lib/types";

export function applyUserPolicy(
  decision: TrustDecision,
  amount: number,
  userPolicy: UserPolicy
): FinalDecision {
  const originalAction = decision.action;
  let action = decision.action;
  let policyReason: string | undefined;
  let effectiveAmount = decision.effectiveAmount;

  if (amount > userPolicy.max_spend_per_transaction) {
    action = "refuse";
    policyReason = `Amount ₹${amount} exceeds max spend per transaction (₹${userPolicy.max_spend_per_transaction})`;
  } else if (amount > userPolicy.max_spend_per_seller) {
    action = "refuse";
    policyReason = `Amount ₹${amount} exceeds max spend per seller (₹${userPolicy.max_spend_per_seller})`;
  } else if (
    action === "capture" &&
    amount > userPolicy.confirm_above_amount
  ) {
    action = "hold";
    policyReason = `Amount ₹${amount} exceeds confirm threshold (₹${userPolicy.confirm_above_amount})`;
  } else if (
    action === "hold" &&
    amount > userPolicy.confirm_above_amount &&
    !policyReason
  ) {
    policyReason = `Amount ₹${amount} exceeds confirm threshold (₹${userPolicy.confirm_above_amount})`;
  }

  if (action === "refuse") {
    effectiveAmount = 0;
  }

  return {
    ...decision,
    action,
    originalAction,
    policyReason,
    effectiveAmount,
    trustReason:
      policyReason && action !== originalAction
        ? `${decision.trustReason}; policy override applied`
        : decision.trustReason,
  };
}
