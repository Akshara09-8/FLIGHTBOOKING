"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  completeMockPayment,
  confirmRazorpayCheckout,
  startBalanceCheckout,
  startDepositCheckout,
  startSubscriptionCheckout,
  type CheckoutResult,
} from "@/lib/payments/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function payer() {
  const { user, profile } = await requireUser();
  return { id: user.id, email: profile.email, name: profile.full_name, phone: profile.phone };
}

export async function startSubscription(planCode: string): Promise<CheckoutResult> {
  return startSubscriptionCheckout(await payer(), String(planCode));
}

export async function startDeposit(poolId: string, partyId: string): Promise<CheckoutResult> {
  if (!UUID.test(poolId) || !UUID.test(partyId)) return { ok: false, error: "We couldn't find those seats." };
  return startDepositCheckout(await payer(), poolId, partyId);
}

export async function startBalance(poolId: string, partyId: string): Promise<CheckoutResult> {
  if (!UUID.test(poolId) || !UUID.test(partyId)) return { ok: false, error: "We couldn't find those seats." };
  return startBalanceCheckout(await payer(), poolId, partyId);
}

export async function confirmCheckout(input: {
  paymentId: string;
  orderId: string;
  gatewayPaymentId: string;
  signature: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireUser();
  if (!UUID.test(input.paymentId)) return { ok: false, error: "Payment not found." };
  return confirmRazorpayCheckout(user.id, input);
}

export async function mockPay(formData: FormData) {
  const paymentId = String(formData.get("paymentId") ?? "");
  const outcome = formData.get("outcome") === "failure" ? "failure" : "success";
  if (!UUID.test(paymentId)) redirect("/payments");
  const { user } = await requireUser();
  await completeMockPayment(user.id, paymentId, outcome);
  redirect(`/payments/${paymentId}`);
}
