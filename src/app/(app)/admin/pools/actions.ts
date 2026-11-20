"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/roles";
import { refundPayment } from "@/lib/payments/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function retryRefund(formData: FormData) {
  const paymentId = String(formData.get("paymentId") ?? "");
  if (!UUID.test(paymentId)) return;
  const { profile } = await requireUser();
  if (!canAccessAdmin(profile.role)) return;
  await refundPayment(paymentId);
  revalidatePath("/admin/pools");
}
