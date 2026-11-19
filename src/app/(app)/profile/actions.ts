"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { fieldErrors, profileSchema } from "@/lib/validation";
import type { FormState } from "@/lib/form-state";

export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = profileSchema.safeParse({
    fullName: formData.get("fullName") ?? "",
    phone: formData.get("phone") ?? "",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName, phone: parsed.data.phone })
    .eq("id", user.id);

  if (error) return { message: "Couldn't save your profile. Try again." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile saved." };
}
