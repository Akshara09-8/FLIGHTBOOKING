import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { gatewayConfig, getGateway, mockGateway, razorpayGateway, type GatewayName } from "./gateway";
import { depositTotal } from "./money";
import { balanceDue } from "@/lib/ops";
import { verifyCheckoutSignature, verifyWebhookSignature } from "./signatures";
import { parseRazorpayWebhook } from "./webhook";

export type CheckoutInfo = {
  paymentId: string;
  gateway: GatewayName;
  orderId: string;
  amountPaise: number;
  publicKey: string | null;
  description: string;
  prefill: { email?: string; name?: string; contact?: string };
};
export type CheckoutResult = { ok: true; checkout: CheckoutInfo } | { ok: false; error: string };

type Payer = { id: string; email: string | null; name: string | null; phone: string | null };

async function createPaymentAndOrder(args: {
  payer: Payer;
  type: "subscription" | "deposit" | "balance";
  amountPaise: number;
  description: string;
  plan?: string;
  poolId?: string;
  partyId?: string;
}): Promise<CheckoutResult> {
  const admin = createAdminClient();
  const gateway = getGateway();

  const { data: payment, error } = await admin
    .from("payments")
    .insert({
      user_id: args.payer.id,
      type: args.type,
      plan: args.plan ?? null,
      pool_id: args.poolId ?? null,
      party_id: args.partyId ?? null,
      amount_paise: args.amountPaise,
      status: "created",
      gateway: gateway.name,
      idempotency_key: `${args.type}:${randomUUID()}`,
    })
    .select("id")
    .single();
  if (error || !payment) return { ok: false, error: "Couldn't start the payment. Try again." };

  try {
    const { orderId } = await gateway.createOrder({
      amountPaise: args.amountPaise,
      receipt: payment.id,
      notes: { payment_id: payment.id, type: args.type },
    });
    await admin.from("payments").update({ gateway_order_id: orderId }).eq("id", payment.id);
    return {
      ok: true,
      checkout: {
        paymentId: payment.id,
        gateway: gateway.name,
        orderId,
        amountPaise: args.amountPaise,
        publicKey: gateway.publicKey,
        description: args.description,
        prefill: {
          email: args.payer.email ?? undefined,
          name: args.payer.name ?? undefined,
          contact: args.payer.phone ?? undefined,
        },
      },
    };
  } catch {
    await admin.rpc("fail_payment", { p_payment_id: payment.id, p_reason: "ORDER_FAILED" });
    return { ok: false, error: "The payment service didn't respond. Try again in a minute." };
  }
}

export async function startSubscriptionCheckout(payer: Payer, planCode: string): Promise<CheckoutResult> {
  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("plans")
    .select("code, name, price_paise")
    .eq("code", planCode)
    .eq("active", true)
    .maybeSingle();
  if (!plan) return { ok: false, error: "That plan isn't available." };
  return createPaymentAndOrder({
    payer,
    type: "subscription",
    plan: plan.code,
    amountPaise: Number(plan.price_paise),
    description: `GroupFly ${plan.name}`,
  });
}

export async function startDepositCheckout(payer: Payer, poolId: string, partyId: string): Promise<CheckoutResult> {
  const admin = createAdminClient();
  const [{ data: members }, { data: pool }, { data: paid }] = await Promise.all([
    admin
      .from("pool_members")
      .select("status, hold_expires_at")
      .eq("pool_id", poolId)
      .eq("party_id", partyId)
      .eq("user_id", payer.id),
    admin.from("pools").select("origin, destination, deposit_paise, status").eq("id", poolId).maybeSingle(),
    admin
      .from("payments")
      .select("id")
      .eq("party_id", partyId)
      .eq("type", "deposit")
      .in("status", ["succeeded", "refunded"])
      .limit(1),
  ]);
  if (!pool || !members || members.length === 0) return { ok: false, error: "We couldn't find those seats." };
  if (paid && paid.length > 0) return { ok: false, error: "The deposit for these seats is already paid." };
  const held = members.filter((m) => m.status === "held");
  if (held.length === 0) {
    return { ok: false, error: "These seats aren't on hold any more. Join the pool again." };
  }
  if (held.some((m) => m.hold_expires_at && new Date(m.hold_expires_at).getTime() <= Date.now())) {
    return { ok: false, error: "The hold on these seats has expired. Join the pool again." };
  }
  return createPaymentAndOrder({
    payer,
    type: "deposit",
    poolId,
    partyId,
    amountPaise: depositTotal(held.length, Number(pool.deposit_paise)),
    description: `Refundable deposit · ${held.length} seat${held.length > 1 ? "s" : ""} · ${pool.origin} → ${pool.destination}`,
  });
}

/** Fare balance once the airline quote is accepted: seats × (final fare − deposit). */
export async function startBalanceCheckout(payer: Payer, poolId: string, partyId: string): Promise<CheckoutResult> {
  const admin = createAdminClient();
  const [{ data: members }, { data: pool }] = await Promise.all([
    admin
      .from("pool_members")
      .select("status, balance_paid_at")
      .eq("pool_id", poolId)
      .eq("party_id", partyId)
      .eq("user_id", payer.id)
      .eq("status", "confirmed"),
    admin
      .from("pools")
      .select("origin, destination, deposit_paise, final_fare_paise, status, balance_due_at")
      .eq("id", poolId)
      .maybeSingle(),
  ]);
  if (!pool || !members || members.length === 0) return { ok: false, error: "We couldn't find those seats." };
  if (pool.status !== "payment_due" || pool.final_fare_paise == null) return { ok: false, error: "No balance is due for this pool." };
  if (pool.balance_due_at && new Date(pool.balance_due_at).getTime() <= Date.now()) {
    return { ok: false, error: "The balance deadline has passed. Contact support." };
  }
  if (members.every((m) => m.balance_paid_at)) return { ok: false, error: "The balance for these seats is already paid." };

  const amount = balanceDue(members.length, Number(pool.final_fare_paise), Number(pool.deposit_paise));
  if (amount === 0) {
    // The deposit already covers the fare.
    await admin.from("pool_members").update({ balance_paid_at: new Date().toISOString() }).eq("party_id", partyId).eq("status", "confirmed");
    return { ok: false, error: "Nothing more to pay: your deposit covers the fare. Your seats are fully paid." };
  }
  return createPaymentAndOrder({
    payer,
    type: "balance",
    poolId,
    partyId,
    amountPaise: amount,
    description: `Fare balance · ${members.length} seat${members.length > 1 ? "s" : ""} · ${pool.origin} → ${pool.destination}`,
  });
}

/** Marks a payment paid (idempotent). Refunds automatically if the seats were already released. */
export async function settlePayment(paymentId: string, gatewayPaymentId: string, amountPaise: number): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("complete_payment", {
    p_payment_id: paymentId,
    p_gateway_payment_id: gatewayPaymentId,
    p_amount_paise: amountPaise,
  });
  if (error) throw new Error(error.message);
  const result = String(data);
  if (result === "refund_required") await refundPayment(paymentId);
  return result;
}

export async function failPayment(paymentId: string, reason: string): Promise<void> {
  const admin = createAdminClient();
  await admin.rpc("fail_payment", { p_payment_id: paymentId, p_reason: reason });
}

/** Refunds a paid deposit in full. Safe to call twice: the second call does nothing. */
export async function refundPayment(paymentId: string): Promise<"refunded" | "skipped" | "error"> {
  const admin = createAdminClient();
  const { data: amount, error } = await admin.rpc("begin_refund", { p_payment_id: paymentId });
  if (error || !amount || Number(amount) <= 0) return "skipped";

  const { data: pay } = await admin.from("payments").select("gateway, gateway_payment_id").eq("id", paymentId).single();
  if (!pay?.gateway_payment_id) return "error";
  try {
    const cfg = gatewayConfig();
    const gateway = pay.gateway === "razorpay" && cfg.name === "razorpay" ? razorpayGateway(cfg) : mockGateway;
    if (pay.gateway === "razorpay" && gateway.name !== "razorpay") return "error";
    const { refundId } = await gateway.refund({
      gatewayPaymentId: pay.gateway_payment_id,
      amountPaise: Number(amount),
      notes: { payment_id: paymentId },
    });
    await admin.rpc("mark_refunded", { p_payment_id: paymentId, p_gateway_refund_id: refundId });
    return "refunded";
  } catch {
    return "error"; // refund_requested_at stays set; an admin can retry after 10 minutes
  }
}

/** Razorpay Checkout handler: verify the signature, then settle. */
export async function confirmRazorpayCheckout(
  userId: string,
  input: { paymentId: string; orderId: string; gatewayPaymentId: string; signature: string },
): Promise<{ ok: boolean; error?: string }> {
  const cfg = gatewayConfig();
  if (cfg.name !== "razorpay") return { ok: false, error: "Razorpay isn't enabled." };
  const admin = createAdminClient();
  const { data: pay } = await admin
    .from("payments")
    .select("id, user_id, amount_paise, gateway_order_id")
    .eq("id", input.paymentId)
    .maybeSingle();
  if (!pay || pay.user_id !== userId || pay.gateway_order_id !== input.orderId) {
    return { ok: false, error: "Payment not found." };
  }
  if (!verifyCheckoutSignature(input.orderId, input.gatewayPaymentId, input.signature, cfg.keySecret)) {
    return { ok: false, error: "We couldn't verify this payment. If money was taken, it will be confirmed or refunded automatically." };
  }
  await settlePayment(pay.id, input.gatewayPaymentId, Number(pay.amount_paise));
  return { ok: true };
}

/** Razorpay webhook: confirms payments even if the customer closed the browser (T3.3). */
export async function handleRazorpayWebhook(
  rawBody: string,
  signature: string | null,
  eventId: string | null,
): Promise<{ status: number; message: string }> {
  const cfg = gatewayConfig();
  if (cfg.name !== "razorpay" || !cfg.webhookSecret) return { status: 400, message: "Webhook not configured" };
  if (!verifyWebhookSignature(rawBody, signature, cfg.webhookSecret)) return { status: 401, message: "Bad signature" };

  const admin = createAdminClient();
  if (eventId) {
    const { data: seen } = await admin
      .from("webhook_events")
      .select("event_id")
      .eq("provider", "razorpay")
      .eq("event_id", eventId)
      .maybeSingle();
    if (seen) return { status: 200, message: "Duplicate delivery ignored" };
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: 400, message: "Invalid JSON" };
  }
  const event = parseRazorpayWebhook(body);
  if (event.kind !== "ignored") {
    const { data: pay } = await admin
      .from("payments")
      .select("id")
      .eq("gateway_order_id", event.orderId)
      .maybeSingle();
    if (pay) {
      if (event.kind === "captured") await settlePayment(pay.id, event.gatewayPaymentId, event.amountPaise);
      else await failPayment(pay.id, event.reason);
    }
  }
  if (eventId) await admin.rpc("record_webhook_event", { p_provider: "razorpay", p_event_id: eventId });
  return { status: 200, message: "ok" };
}

/** Built-in test gateway: the "payment page" is our own /pay/mock screen. */
export async function completeMockPayment(
  userId: string,
  paymentId: string,
  outcome: "success" | "failure",
): Promise<{ ok: boolean; error?: string }> {
  if (gatewayConfig().name !== "mock") return { ok: false, error: "The test gateway is turned off." };
  const admin = createAdminClient();
  const { data: pay } = await admin
    .from("payments")
    .select("id, user_id, amount_paise, gateway, status")
    .eq("id", paymentId)
    .maybeSingle();
  if (!pay || pay.user_id !== userId || pay.gateway !== "mock") return { ok: false, error: "Payment not found." };
  if (pay.status !== "created") return { ok: true };

  if (outcome === "success") {
    await settlePayment(pay.id, `mock_pay_${randomUUID().replace(/-/g, "").slice(0, 16)}`, Number(pay.amount_paise));
  } else {
    await failPayment(pay.id, "Test card declined");
  }
  return { ok: true };
}
