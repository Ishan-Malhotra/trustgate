import type { CatalogSearchStatus } from "@/lib/catalog/types"
import type { FinalDecision } from "@/lib/types"

export interface PaymentAuthorizationInput {
  sellerId: string
  amount: number
  action: "capture" | "hold"
  /** Exact per-seller decision only — never a lastDecision fallback. */
  decision: FinalDecision | undefined
  shoppingStatus?: CatalogSearchStatus
  shoppingChosenSellerId?: string
}

export type PaymentAuthorizationResult =
  | { ok: true; payAmount: number }
  | { ok: false; error: string }

/**
 * Server-side payment boundary. Prompts are not enough: the LLM can still
 * call authorizeOrCapture with the wrong action or seller.
 */
export function assertPaymentAuthorized(
  input: PaymentAuthorizationInput
): PaymentAuthorizationResult {
  const {
    sellerId,
    amount,
    action,
    decision,
    shoppingStatus,
    shoppingChosenSellerId,
  } = input

  if (!decision || decision.tier === undefined) {
    return {
      ok: false,
      error: "Must check trust for this seller before payment",
    }
  }

  const shoppingBlock = assertShoppingAllowsPayment(
    sellerId,
    action,
    shoppingStatus,
    shoppingChosenSellerId
  )
  if (!shoppingBlock.ok) return shoppingBlock

  if (decision.action === "refuse") {
    return { ok: false, error: "Payment refused by trust/policy gates" }
  }

  if (action !== decision.action) {
    return {
      ok: false,
      error: `Payment action must match TrustGate decision (expected ${decision.action}, got ${action})`,
    }
  }

  if (decision.spendLimit !== null && amount > decision.spendLimit) {
    return {
      ok: false,
      error: `Amount exceeds spend limit of ₹${decision.spendLimit}`,
    }
  }

  return { ok: true, payAmount: decision.effectiveAmount }
}

function assertShoppingAllowsPayment(
  sellerId: string,
  action: "capture" | "hold",
  shoppingStatus?: CatalogSearchStatus,
  shoppingChosenSellerId?: string
): PaymentAuthorizationResult {
  if (!shoppingStatus) {
    return { ok: true, payAmount: 0 }
  }

  if (shoppingStatus === "no_suppliers" || shoppingStatus === "no_viable") {
    return {
      ok: false,
      error: `Catalog status ${shoppingStatus} — do not call payment tools`,
    }
  }

  if (shoppingStatus === "requires_confirmation") {
    return {
      ok: false,
      error:
        "Catalog status requires_confirmation — do not call authorizeOrCapture in this request. Ask the user to confirm a bounded hold first.",
    }
  }

  if (shoppingStatus === "authorized") {
    if (action !== "capture") {
      return {
        ok: false,
        error:
          "Catalog status authorized only allows capture for the chosen seller",
      }
    }
    if (
      shoppingChosenSellerId &&
      sellerId !== shoppingChosenSellerId
    ) {
      return {
        ok: false,
        error:
          "Catalog authorized a different seller — pay only the chosen CAPTURE seller",
      }
    }
  }

  return { ok: true, payAmount: 0 }
}
