"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  createPoolSchema,
  cutOffEndOfDayIST,
  poolErrorMessage,
  searchSchema,
} from "@/lib/pools";
import { fieldErrors } from "@/lib/validation";
import type { FormState } from "@/lib/form-state";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function joinPool(_prev: FormState, formData: FormData): Promise<FormState> {
  const poolId = String(formData.get("poolId") ?? "");
  const travellerIds = formData.getAll("travellerIds").map(String);
  const code = String(formData.get("code") ?? "").trim();
  if (!UUID.test(poolId)) return { message: poolErrorMessage("POOL_NOT_FOUND") };
  if (travellerIds.length === 0) return { errors: { travellerIds: poolErrorMessage("NO_TRAVELLERS") } };
  if (!travellerIds.every((id) => UUID.test(id))) return { message: poolErrorMessage("TRAVELLER_NOT_YOURS") };

  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("join_pool", {
    p_pool_id: poolId,
    p_traveller_ids: travellerIds,
    p_invite_code: code || null,
  });
  if (error) return { message: poolErrorMessage(error.message) };

  const row = (data as { r_member_status: string; r_seats_filled: number }[] | null)?.[0];
  revalidatePath(`/pools/${poolId}`);
  revalidatePath("/dashboard");
  const n = travellerIds.length;
  return row?.r_member_status === "waitlisted"
    ? {
        ok: true,
        message: `The pool is full, so your group of ${n} is on the waitlist. You'll move up together if ${n} seat${n > 1 ? "s" : ""} free up.`,
      }
    : { ok: true, message: `You're in. ${n} seat${n > 1 ? "s" : ""} held for your group.` };
}

export async function leavePool(_prev: FormState, formData: FormData): Promise<FormState> {
  const poolId = String(formData.get("poolId") ?? "");
  if (!UUID.test(poolId)) return { message: poolErrorMessage("POOL_NOT_FOUND") };

  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("leave_pool", { p_pool_id: poolId });
  if (error) return { message: poolErrorMessage(error.message) };

  revalidatePath(`/pools/${poolId}`);
  revalidatePath("/dashboard");
  return { ok: true, message: "You've left the pool and your seats were released." };
}

export async function createAlert(formData: FormData) {
  const parsed = searchSchema.safeParse({
    from: formData.get("origin"),
    to: formData.get("destination"),
    date: formData.get("travelDate"),
  });
  if (!parsed.success || !parsed.data.date) redirect("/pools");

  const { supabase, user } = await requireUser();
  await supabase.from("pool_alerts").upsert(
    { user_id: user.id, origin: parsed.data.from, destination: parsed.data.to, travel_date: parsed.data.date },
    { onConflict: "user_id,origin,destination,travel_date", ignoreDuplicates: true },
  );
  const q = new URLSearchParams({ from: parsed.data.from, to: parsed.data.to, date: parsed.data.date, alert: "1" });
  redirect(`/pools?${q}`);
}

export async function createPool(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = createPoolSchema.safeParse({
    festivalId: formData.get("festivalId") ?? "",
    origin: formData.get("origin") ?? "",
    destination: formData.get("destination") ?? "",
    travelDate: formData.get("travelDate") ?? "",
    timeWindow: formData.get("timeWindow") ?? "",
    minSeats: formData.get("minSeats") ?? "",
    maxSeats: formData.get("maxSeats") ?? "",
    cutOffDate: formData.get("cutOffDate") ?? "",
    marketFare: formData.get("marketFare") || undefined,
    targetFare: formData.get("targetFare") || undefined,
    isPrivate: formData.get("isPrivate") === "on",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const v = parsed.data;

  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("create_pool", {
    p_festival_id: v.festivalId ?? null,
    p_origin: v.origin,
    p_destination: v.destination,
    p_travel_date: v.travelDate,
    p_time_window: v.timeWindow,
    p_min_seats: v.minSeats,
    p_max_seats: v.maxSeats,
    p_cut_off_at: cutOffEndOfDayIST(v.cutOffDate),
    p_market_fare_paise: v.marketFare != null ? v.marketFare * 100 : null,
    p_target_fare_paise: v.targetFare != null ? v.targetFare * 100 : null,
    p_is_private: v.isPrivate,
  });
  if (error || typeof data !== "string") return { message: poolErrorMessage(error?.message) };

  revalidatePath("/pools");
  redirect(`/pools/${data}`);
}
