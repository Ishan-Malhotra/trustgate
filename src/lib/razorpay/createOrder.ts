import { getRazorpayClient } from "./client";

export interface CreateOrderResult {
  orderId: string;
  amount: number;
  currency: string;
  status: string;
}

export async function createOrder(
  amountInr: number,
  receipt: string
): Promise<CreateOrderResult> {
  const razorpay = getRazorpayClient();
  const amountPaise = Math.round(amountInr * 100);

  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt,
    payment_capture: false,
  });

  return {
    orderId: order.id,
    amount: amountInr,
    currency: order.currency,
    status: order.status,
  };
}
