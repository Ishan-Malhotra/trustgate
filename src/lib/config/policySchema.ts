import { z } from "zod";

export const userPolicySchema = z.object({
  max_spend_per_transaction: z.number().positive(),
  max_spend_per_seller: z.number().positive(),
  confirm_above_amount: z.number().positive(),
  hold_expiry_seconds: z.number().positive(),
});
