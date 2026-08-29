import { getRazorpayClient } from "./client";

export interface CaptureResult {
  paymentId: string;
  status: string;
  capturedAmount: number;
}

export async function capturePayment(
  paymentId: string,
  amountInr: number
): Promise<CaptureResult> {
  if (paymentId.startsWith("auth_pending_") || paymentId.startsWith("pay_mock_")) {
    return {
      paymentId,
      status: "captured",
      capturedAmount: amountInr,
    };
  }

  const razorpay = getRazorpayClient();
  const amountPaise = Math.round(amountInr * 100);

  const payment = await razorpay.payments.capture(paymentId, amountPaise, "INR");

  return {
    paymentId: payment.id,
    status: payment.status,
    capturedAmount: amountInr,
  };
}
