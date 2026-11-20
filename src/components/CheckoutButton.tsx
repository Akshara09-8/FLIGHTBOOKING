"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CheckoutResult } from "@/lib/payments/service";
import { confirmCheckout } from "@/app/payments/actions";

type RazorpayResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayInstance = { open(): void; on(event: string, cb: (r: { error?: { description?: string } }) => void): void };
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

/**
 * Starts a payment: creates the order on the server, then opens Razorpay Checkout
 * (test mode) or the built-in test payment page.
 */
export function CheckoutButton({
  start,
  label,
  className = "btn-primary w-full",
}: {
  start: () => Promise<CheckoutResult>;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const result = await start();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const c = result.checkout;
      if (c.gateway === "mock") {
        router.push(`/pay/mock/${c.paymentId}`);
        return;
      }
      if (!(await loadRazorpay()) || !window.Razorpay) {
        setError("Couldn't load the payment window. Check your connection and try again.");
        return;
      }
      const rzp = new window.Razorpay({
        key: c.publicKey,
        amount: c.amountPaise,
        currency: "INR",
        name: "GroupFly",
        description: c.description,
        order_id: c.orderId,
        prefill: c.prefill,
        theme: { color: "#0F5E63" },
        handler: async (r: RazorpayResponse) => {
          const res = await confirmCheckout({
            paymentId: c.paymentId,
            orderId: r.razorpay_order_id,
            gatewayPaymentId: r.razorpay_payment_id,
            signature: r.razorpay_signature,
          });
          if (!res.ok) setError(res.error ?? "Payment couldn't be confirmed.");
          router.push(`/payments/${c.paymentId}`);
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on("payment.failed", (r) => setError(r.error?.description ?? "The payment failed. You can try again."));
      rzp.open();
    } catch {
      setError("Something went wrong starting the payment. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" className={className} onClick={onClick} disabled={busy}>
        {busy ? "Starting payment…" : label}
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
