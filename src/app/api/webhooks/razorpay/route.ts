import { NextResponse, type NextRequest } from "next/server";
import { handleRazorpayWebhook } from "@/lib/payments/service";

export const dynamic = "force-dynamic";

/**
 * Razorpay webhook (Dashboard -> Settings -> Webhooks, test mode).
 * Events: payment.captured, payment.failed, order.paid.
 * The raw body is verified with RAZORPAY_WEBHOOK_SECRET before anything is read from it.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  try {
    const result = await handleRazorpayWebhook(
      raw,
      req.headers.get("x-razorpay-signature"),
      req.headers.get("x-razorpay-event-id"),
    );
    return NextResponse.json({ message: result.message }, { status: result.status });
  } catch {
    // 500 makes Razorpay retry later; processing is idempotent.
    return NextResponse.json({ message: "Temporary error" }, { status: 500 });
  }
}
