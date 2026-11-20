"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/roles";
import { poolErrorMessage } from "@/lib/pools";
import { refundPayment } from "@/lib/payments/service";
import type { FormState } from "@/lib/form-state";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Closes a pool, releases every seat and refunds all paid deposits (T3.6). */
export async function dissolvePool(_prev: FormState, formData: FormData): Promise<FormState> {
  const poolId = String(formData.get("poolId") ?? "");
  if (!UUID.test(poolId)) return { message: "Pool not found." };
  const { supabase, profile } = await requireUser();
  if (!canAccessAdmin(profile.role)) return { message: "Admins only." };

  const { data, error } = await supabase.rpc("dissolve_pool", { p_pool_id: poolId });
  if (error) return { message: poolErrorMessage(error.message) };

  const ids = (data as string[] | null) ?? [];
  const results = await Promise.all(ids.map((id) => refundPayment(id)));
  const refunded = results.filter((r) => r === "refunded").length;
  const pending = ids.length - refunded;

  revalidatePath("/admin/pools");
  revalidatePath(`/pools/${poolId}`);
  return {
    ok: pending === 0,
    message:
      ids.length === 0
        ? "Pool closed. No deposits had been paid."
        : `Pool closed. ${refunded} of ${ids.length} deposits refunded${pending ? `; ${pending} will need a retry below` : ""}.`,
  };
}

export async function retryRefund(formData: FormData) {
  const paymentId = String(formData.get("paymentId") ?? "");
  if (!UUID.test(paymentId)) return;
  const { profile } = await requireUser();
  if (!canAccessAdmin(profile.role)) return;
  await refundPayment(paymentId);
  revalidatePath("/admin/pools");
}
