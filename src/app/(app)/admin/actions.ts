"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { canAccessAdmin, isRole } from "@/lib/roles";

export async function changeRole(formData: FormData) {
  const { supabase, profile } = await requireUser();
  if (!canAccessAdmin(profile.role)) return; // RLS and the DB trigger also refuse this.

  const userId = String(formData.get("userId") ?? "");
  const role = formData.get("role");
  if (!isRole(role) || userId === profile.id) return; // Admins can't demote themselves by accident.

  const { data: before } = await supabase.from("profiles").select("role").eq("id", userId).single();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) return;

  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "change_role",
    entity: "profiles",
    entity_id: userId,
    before: before ?? null,
    after: { role },
  });
  revalidatePath("/admin");
}
