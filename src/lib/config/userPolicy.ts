import type { UserPolicy } from "@/lib/types";

/** Default user spending rules — visible config object, editable in principle. */
export const USER_POLICY: UserPolicy = {
  max_spend_per_transaction: 5000,
  max_spend_per_seller: 10000,
  confirm_above_amount: 300,
  hold_expiry_seconds: 3600,
};
