"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/roles";
import { acceptSchema, endOfDayIST, opsErrorMessage, pnrSchema, quoteSchema, rfqSchema } from "@/lib/ops";
import { poolErrorMessage } from "@/lib/pools";
import { fieldErrors } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { refundPayment } from "@/lib/payments/service";
import type { FormState } from "@/lib/form-state";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TICKET_BYTES = 2 * 1024 * 1024;
const TICKET_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };

async function admin() {
  const ctx = await requireUser();
  if (!canAccessAdmin(ctx.profile.role)) throw new Error("Admins only");
  return ctx;
}

function done(poolId: string, message: string): FormState {
  revalidatePath(`/admin/pools/${poolId}`);
  revalidatePath("/admin/pools");
  revalidatePath(`/pools/${poolId}`);
  return { ok: true, message };
}

export async function sendRfq(poolId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!UUID.test(poolId)) return { message: "Pool not found." };
  const parsed = rfqSchema.safeParse({
    airline: formData.get("airline") ?? "",
    recipientEmail: formData.get("recipientEmail") ?? "",
    message: formData.get("message") ?? undefined,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { supabase } = await admin();
  const { error } = await supabase.rpc("send_rfq", {
    p_pool_id: poolId,
    p_airline: parsed.data.airline,
    p_recipient_email: parsed.data.recipientEmail ?? null,
    p_message: parsed.data.message ?? null,
  });
  if (error) return { message: opsErrorMessage(error.message) };
  return done(poolId, "Fare request logged. Copy the email below or download the PDF and send it to the airline.");
}

export async function recordQuote(poolId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!UUID.test(poolId)) return { message: "Pool not found." };
  const parsed = quoteSchema.safeParse({
    airline: formData.get("airline") ?? "",
    fareRupees: formData.get("fareRupees") ?? "",
    validUntil: formData.get("validUntil") ?? "",
    nameDeadline: formData.get("nameDeadline") ?? "",
    notes: formData.get("notes") ?? undefined,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const { supabase } = await admin();
  const { error } = await supabase.rpc("record_quote", {
    p_pool_id: poolId,
    p_airline: v.airline,
    p_fare_per_seat_paise: v.fareRupees * 100,
    p_valid_until: endOfDayIST(v.validUntil),
    p_name_deadline: endOfDayIST(v.nameDeadline),
    p_notes: v.notes ?? null,
  });
  if (error) return { message: opsErrorMessage(error.message) };
  return done(poolId, "Quote recorded.");
}

export async function rejectQuote(poolId: string, quoteId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!UUID.test(quoteId)) return { message: "Quote not found." };
  const { supabase } = await admin();
  const { error } = await supabase.rpc("reject_quote", {
    p_quote_id: quoteId,
    p_reason: String(formData.get("reason") ?? "").slice(0, 300),
  });
  if (error) return { message: opsErrorMessage(error.message) };
  return done(poolId, "Quote rejected. You can send the fare request again.");
}

export async function acceptQuote(poolId: string, quoteId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!UUID.test(quoteId)) return { message: "Quote not found." };
  const parsed = acceptSchema.safeParse({ balanceDueDate: formData.get("balanceDueDate") ?? "" });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { supabase } = await admin();
  const { data, error } = await supabase.rpc("accept_quote", {
    p_quote_id: quoteId,
    p_balance_due_at: endOfDayIST(parsed.data.balanceDueDate),
  });
  if (error) return { message: opsErrorMessage(error.message) };
  return done(poolId, `Quote accepted. ${Number(data)} group${Number(data) === 1 ? "" : "s"} asked to pay the balance.`);
}

export async function submitNames(poolId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await admin();
  const { data, error } = await supabase.rpc("submit_names", {
    p_pool_id: poolId,
    p_force: formData.get("force") === "on",
  });
  if (error) return { message: opsErrorMessage(error.message) };
  const released = Number(data);
  return done(
    poolId,
    released > 0
      ? `Names locked. ${released} unpaid seat${released === 1 ? " was" : "s were"} released. Download the manifest for the airline.`
      : "Names locked. Download the manifest for the airline.",
  );
}

/** Saves a passenger's PNR / ticket number and, optionally, the e-ticket file (T4.5). */
export async function saveTicket(
  poolId: string,
  travellerId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!UUID.test(poolId) || !UUID.test(travellerId)) return { message: "Passenger not found." };
  const pnr = pnrSchema.safeParse(formData.get("pnr") ?? "");
  if (!pnr.success) return { errors: { pnr: pnr.error.issues[0].message } };
  const ticketNumber = String(formData.get("ticketNumber") ?? "").trim().slice(0, 20);
  const file = formData.get("file");

  const { supabase } = await admin();
  let filePath: string | null = null;
  if (file instanceof File && file.size > 0) {
    const ext = TICKET_TYPES[file.type];
    if (!ext) return { errors: { file: "Upload a PDF, PNG or JPG." } };
    if (file.size > MAX_TICKET_BYTES) return { errors: { file: "Keep the file under 2 MB." } };
    filePath = `${poolId}/${travellerId}.${ext}`;
    const { error: upErr } = await createAdminClient()
      .storage.from("tickets")
      .upload(filePath, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true });
    if (upErr) return { message: "Couldn't upload the file. Check the 'tickets' storage bucket exists." };
  }

  const { data, error } = await supabase.rpc("set_ticket", {
    p_pool_id: poolId,
    p_traveller_id: travellerId,
    p_pnr: pnr.data,
    p_ticket_number: ticketNumber || null,
    p_file_path: filePath,
  });
  if (error) return { message: opsErrorMessage(error.message) };
  return done(poolId, data === "ticketed" ? "Saved. Every passenger now has a ticket: pool is Ticketed." : "Saved.");
}

export async function markCompleted(poolId: string): Promise<FormState> {
  const { supabase } = await admin();
  const { error } = await supabase.rpc("mark_completed", { p_pool_id: poolId });
  if (error) return { message: opsErrorMessage(error.message) };
  return done(poolId, "Pool marked completed.");
}

/** Closes a pool, releases every seat and refunds every paid deposit and balance. */
export async function closePool(poolId: string): Promise<FormState> {
  const { supabase } = await admin();
  const { data, error } = await supabase.rpc("dissolve_pool", { p_pool_id: poolId });
  if (error) return { message: poolErrorMessage(error.message) };

  // dissolve_pool lists paid deposits; paid balances are refunded too.
  const { data: balances } = await supabase
    .from("payments")
    .select("id")
    .eq("pool_id", poolId)
    .eq("type", "balance")
    .eq("status", "succeeded");
  const ids = [...((data as string[] | null) ?? []), ...(balances ?? []).map((b) => b.id as string)];
  const results = await Promise.all(ids.map((id) => refundPayment(id)));
  const refunded = results.filter((r) => r === "refunded").length;
  return done(
    poolId,
    ids.length === 0
      ? "Pool closed. Nothing had been paid."
      : `Pool closed. ${refunded} of ${ids.length} payments refunded${refunded < ids.length ? "; retry the rest from Operations" : ""}.`,
  );
}
