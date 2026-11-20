import { createHmac, timingSafeEqual } from "node:crypto";

export function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Razorpay Checkout success: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string,
): boolean {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  return safeEqualHex(hmacSha256Hex(keySecret, `${orderId}|${paymentId}`), signature);
}

/** Razorpay webhook: X-Razorpay-Signature = HMAC_SHA256(raw request body, webhook_secret). */
export function verifyWebhookSignature(rawBody: string, signature: string | null, webhookSecret: string): boolean {
  if (!signature || !webhookSecret) return false;
  return safeEqualHex(hmacSha256Hex(webhookSecret, rawBody), signature);
}
