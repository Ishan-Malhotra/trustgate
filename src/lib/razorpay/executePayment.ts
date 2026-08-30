import { authorizeOnly } from "./authorizeOnly";
import { capturePayment } from "./capturePayment";
import { createOrder } from "./createOrder";
import { isRazorpayConfigured } from "./client";
import { withRazorpayRetry } from "./retry";
import { logAudit } from "@/lib/audit/logger";

export interface PaymentExecutionResult {
  success: boolean;
  flagged: boolean;
  retried: boolean;
  mode: "razorpay" | "mock";
  action: "capture" | "hold";
  amount: number;
  orderId?: string;
  paymentId?: string;
  status?: string;
  error?: string;
}

function isRealPaymentId(paymentId: string): boolean {
  return paymentId.startsWith("pay_");
}

export async function executeApprovedPayment(input: {
  sellerId: string;
  sellerName: string;
  amount: number;
  action: "capture" | "hold";
}): Promise<PaymentExecutionResult> {
  const { sellerId, sellerName, amount, action } = input;

  if (!isRazorpayConfigured()) {
    const mock: PaymentExecutionResult = {
      success: true,
      flagged: false,
      retried: false,
      mode: "mock",
      action,
      amount,
      orderId: `order_mock_${Date.now()}`,
      paymentId: `pay_mock_${Date.now()}`,
      status: action === "capture" ? "captured" : "authorized",
    };
    logAudit("payment", `Mock ${action} for ${sellerName}`, { ...mock });
    return mock;
  }

  const receipt = `tg-${sellerId}-${Date.now()}`;
  const orderResult = await withRazorpayRetry("createOrder", () =>
    createOrder(amount, receipt)
  );

  if (!orderResult.success || !orderResult.data) {
    return {
      success: false,
      flagged: true,
      retried: orderResult.retried,
      mode: "razorpay",
      action,
      amount,
      error: orderResult.error ?? "Order creation failed",
    };
  }

  const authResult = await withRazorpayRetry("authorizeOnly", () =>
    authorizeOnly(orderResult.data!.orderId, amount)
  );

  if (!authResult.success || !authResult.data) {
    return {
      success: false,
      flagged: true,
      retried: authResult.retried,
      mode: "razorpay",
      action,
      amount,
      orderId: orderResult.data.orderId,
      error: authResult.error ?? "Authorization failed",
    };
  }

  const paymentId = authResult.data.paymentId;
  const canCapture = isRealPaymentId(paymentId);

  if (action === "capture" && canCapture) {
    const captureResult = await withRazorpayRetry("capturePayment", () =>
      capturePayment(paymentId, amount)
    );

    if (!captureResult.success || !captureResult.data) {
      return {
        success: false,
        flagged: true,
        retried: captureResult.retried,
        mode: "razorpay",
        action,
        amount,
        orderId: orderResult.data.orderId,
        paymentId,
        error: captureResult.error ?? "Capture failed",
      };
    }

    const captured: PaymentExecutionResult = {
      success: true,
      flagged: false,
      retried: captureResult.retried,
      mode: "razorpay",
      action,
      amount,
      orderId: orderResult.data.orderId,
      paymentId: captureResult.data.paymentId,
      status: captureResult.data.status,
    };
    logAudit("payment", `Captured payment for ${sellerName}`, { ...captured });
    return captured;
  }

  const held: PaymentExecutionResult = {
    success: true,
    flagged: false,
    retried: authResult.retried || orderResult.retried,
    mode: "razorpay",
    action,
    amount,
    orderId: orderResult.data.orderId,
    paymentId: canCapture ? paymentId : undefined,
    status: canCapture ? authResult.data.status : "order_created",
  };

  logAudit(
    "payment",
    action === "hold"
      ? `Authorized (hold) for ${sellerName}`
      : `Order created for ${sellerName} (capture pending checkout payment)`,
    { ...held }
  );

  return held;
}
