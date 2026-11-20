/** The parts of a Razorpay webhook GroupFly acts on. */
export type ParsedWebhook =
  | { kind: "captured"; orderId: string; gatewayPaymentId: string; amountPaise: number }
  | { kind: "failed"; orderId: string; gatewayPaymentId: string; reason: string }
  | { kind: "ignored"; event: string };

type RazorpayPayment = {
  id?: string;
  order_id?: string;
  amount?: number;
  error_description?: string;
  error_reason?: string;
};

export function parseRazorpayWebhook(body: unknown): ParsedWebhook {
  const b = body as { event?: string; payload?: { payment?: { entity?: RazorpayPayment } } };
  const event = b?.event ?? "unknown";
  const p = b?.payload?.payment?.entity;
  if (!p?.id || !p.order_id) return { kind: "ignored", event };

  if (event === "payment.captured" || event === "order.paid") {
    if (typeof p.amount !== "number" || !Number.isInteger(p.amount)) return { kind: "ignored", event };
    return { kind: "captured", orderId: p.order_id, gatewayPaymentId: p.id, amountPaise: p.amount };
  }
  if (event === "payment.failed") {
    return {
      kind: "failed",
      orderId: p.order_id,
      gatewayPaymentId: p.id,
      reason: p.error_description || p.error_reason || "Payment failed",
    };
  }
  return { kind: "ignored", event };
}
