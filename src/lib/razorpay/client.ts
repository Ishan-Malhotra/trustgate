import Razorpay from "razorpay";
import { getEnvValue } from "@/lib/config/env";

let client: Razorpay | null = null;

export function getRazorpayClient(): Razorpay {
  const keyId = getEnvValue("RAZORPAY_KEY_ID");
  const keySecret = getEnvValue("RAZORPAY_KEY_SECRET");

  if (!keyId || !keySecret) {
    throw new Error(
      "Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET environment variables"
    );
  }

  if (!client) {
    client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }

  return client;
}

export function isRazorpayConfigured(): boolean {
  return Boolean(
    getEnvValue("RAZORPAY_KEY_ID") && getEnvValue("RAZORPAY_KEY_SECRET")
  );
}
