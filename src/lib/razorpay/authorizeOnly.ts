import { getRazorpayClient } from "./client";

export interface AuthorizeResult {
  paymentId: string;
  orderId: string;
  status: string;
  amount: number;
}

/**
 * Authorize-only step: validates the order exists and returns an authorization
 * reference. Full card authorization in Razorpay test mode requires checkout;
 * use RAZORPAY_TEST_PAYMENT_ID for end-to-end capture testing.
 */
export async function authorizeOnly(
  orderId: string,
  amountInr: number
): Promise<AuthorizeResult> {
  const razorpay = getRazorpayClient();
  const order = await razorpay.orders.fetch(orderId);

  const testPaymentId = process.env.RAZORPAY_TEST_PAYMENT_ID;
  if (testPaymentId) {
    const payment = await razorpay.payments.fetch(testPaymentId);
    return {
      paymentId: payment.id,
      orderId,
      status: payment.status,
      amount: amountInr,
    };
  }

  return {
    paymentId: `auth_pending_${order.id}`,
    orderId: order.id,
    status: order.status ?? "created",
    amount: amountInr,
  };
}
