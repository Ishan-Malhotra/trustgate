import { createOrder } from "./createOrder";
import { authorizeOnly } from "./authorizeOnly";
import { capturePayment } from "./capturePayment";

export { isRazorpayConfigured } from "./client";

export type RazorpayOperation = "createOrder" | "authorizeOnly" | "capture";

export interface RazorpayCallResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  retried: boolean;
  flagged: boolean;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRazorpayRetry<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<RazorpayCallResult<T>> {
  let lastError: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await fn();
      return { success: true, data, retried: attempt > 0, flagged: false };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === 0) {
        await sleep(500);
      }
    }
  }

  return {
    success: false,
    error: lastError,
    retried: true,
    flagged: true,
  };
}

export { createOrder, authorizeOnly, capturePayment };
