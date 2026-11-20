import { randomUUID } from "node:crypto";

export type GatewayName = "mock" | "razorpay";

export type CreateOrderInput = { amountPaise: number; receipt: string; notes: Record<string, string> };

export interface Gateway {
  name: GatewayName;
  /** Public key shown to the browser checkout (Razorpay key_id). */
  publicKey: string | null;
  createOrder(input: CreateOrderInput): Promise<{ orderId: string }>;
  refund(input: { gatewayPaymentId: string; amountPaise: number; notes?: Record<string, string> }): Promise<{
    refundId: string;
  }>;
}

export type GatewayConfig =
  | { name: "mock" }
  | { name: "razorpay"; keyId: string; keySecret: string; webhookSecret: string | null };

/** Reads PAYMENT_GATEWAY. Defaults to the built-in mock gateway so the demo works with no keys. */
export function gatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const name = (env.PAYMENT_GATEWAY ?? "mock").toLowerCase();
  if (name === "razorpay") {
    const keyId = env.RAZORPAY_KEY_ID ?? "";
    const keySecret = env.RAZORPAY_KEY_SECRET ?? "";
    if (!keyId || !keySecret) throw new Error("PAYMENT_GATEWAY=razorpay needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
    if (keyId.startsWith("rzp_live_")) {
      throw new Error("Live Razorpay keys are blocked in this demo. Use test keys (rzp_test_...).");
    }
    return { name: "razorpay", keyId, keySecret, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || null };
  }
  return { name: "mock" };
}

export const mockGateway: Gateway = {
  name: "mock",
  publicKey: null,
  async createOrder() {
    return { orderId: `mock_order_${randomUUID().replace(/-/g, "").slice(0, 16)}` };
  },
  async refund() {
    return { refundId: `mock_rfnd_${randomUUID().replace(/-/g, "").slice(0, 16)}` };
  },
};

export function razorpayGateway(cfg: Extract<GatewayConfig, { name: "razorpay" }>): Gateway {
  const auth = `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}`;
  async function call<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
    if (!res.ok) throw new Error(`Razorpay ${path} failed: ${json.error?.description ?? res.status}`);
    return json;
  }
  return {
    name: "razorpay",
    publicKey: cfg.keyId,
    async createOrder({ amountPaise, receipt, notes }) {
      const order = await call<{ id: string }>("/orders", {
        amount: amountPaise,
        currency: "INR",
        receipt: receipt.slice(0, 40),
        notes,
      });
      return { orderId: order.id };
    },
    async refund({ gatewayPaymentId, amountPaise, notes }) {
      const r = await call<{ id: string }>(`/payments/${encodeURIComponent(gatewayPaymentId)}/refund`, {
        amount: amountPaise,
        notes: notes ?? {},
      });
      return { refundId: r.id };
    },
  };
}

export function getGateway(): Gateway {
  const cfg = gatewayConfig();
  return cfg.name === "razorpay" ? razorpayGateway(cfg) : mockGateway;
}
