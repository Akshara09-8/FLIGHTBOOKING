"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { fieldErrors, travellerSchema } from "@/lib/validation";
import type { FormState } from "@/lib/form-state";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parse(formData: FormData) {
  return travellerSchema().safeParse({
    fullNameAsOnId: formData.get("fullNameAsOnId") ?? "",
    dateOfBirth: formData.get("dateOfBirth") ?? "",
    gender: formData.get("gender") ?? "",
    isSelf: formData.get("isSelf") === "on",
  });
}

function dbError(code: string | undefined): FormState {
  if (code === "23505") return { errors: { isSelf: "Another traveller is already marked as you." } };
  return { message: "Couldn't save the traveller. Try again." };
}

export async function createTraveller(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parse(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("travellers").insert({
    user_id: user.id,
    full_name_as_on_id: parsed.data.fullNameAsOnId,
    date_of_birth: parsed.data.dateOfBirth,
    gender: parsed.data.gender,
    is_self: parsed.data.isSelf,
  });
  if (error) return dbError(error.code);

  revalidatePath("/travellers");
  revalidatePath("/dashboard");
  return { ok: true, message: `${parsed.data.fullNameAsOnId} added.` };
}

export async function updateTraveller(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!UUID.test(id)) return { message: "Traveller not found." };
  const parsed = parse(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { supabase, user } = await requireUser();
  // RLS limits this to the user's own rows; the user_id filter makes "not found" explicit.
  const { data, error } = await supabase
    .from("travellers")
    .update({
      full_name_as_on_id: parsed.data.fullNameAsOnId,
      date_of_birth: parsed.data.dateOfBirth,
      gender: parsed.data.gender,
      is_self: parsed.data.isSelf,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");
  if (error) return dbError(error.code);
  if (!data || data.length === 0) return { message: "Traveller not found." };

  revalidatePath("/travellers");
  redirect("/travellers");
}

export async function deleteTraveller(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return;
  const { supabase, user } = await requireUser();
  await supabase.from("travellers").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath("/travellers");
  revalidatePath("/dashboard");
}
