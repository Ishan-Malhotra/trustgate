import type { UserPolicy } from "@/lib/types";

/** Default user spending rules — editable in the demo UI. */
export const USER_POLICY: UserPolicy = {
  max_spend_per_transaction: 5000,
  max_spend_per_seller: 10000,
  confirm_above_amount: 300,
  hold_expiry_seconds: 3600,
};

export const mergeUserPolicy = (
  partial?: Partial<UserPolicy> | null
): UserPolicy => ({
  ...USER_POLICY,
  ...partial,
});
