import { logAudit } from "@/lib/audit/logger";

export interface RazorpayCallResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  retried: boolean;
  flagged: boolean;
}

const RAZORPAY_TIMEOUT_MS = 8000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Razorpay timeout after ${ms}ms`));
    }, ms);

    fn()
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function withRazorpayRetry<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<RazorpayCallResult<T>> {
  let lastError: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await withTimeout(fn, RAZORPAY_TIMEOUT_MS);
      if (attempt > 0) {
        logAudit("payment", `Razorpay ${operation} succeeded on retry`, {
          operation,
          attempt: attempt + 1,
        });
      }
      return { success: true, data, retried: attempt > 0, flagged: false };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logAudit("error", `Razorpay ${operation} failed (attempt ${attempt + 1})`, {
        operation,
        attempt: attempt + 1,
        error: lastError,
      });
      if (attempt === 0) {
        await sleep(500);
      }
    }
  }

  logAudit(
    "flagged",
    `FLAGGED unresolved: Razorpay ${operation} failed after retry`,
    {
      operation,
      error: lastError,
      flagged: true,
      unresolved: true,
    }
  );

  return {
    success: false,
    error: lastError,
    retried: true,
    flagged: true,
  };
}
