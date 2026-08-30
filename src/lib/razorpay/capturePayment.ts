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
  if (!paymentId.startsWith("pay_")) {
    throw new Error(
      `Cannot capture: ${paymentId} is not a Razorpay payment id`
    );
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
