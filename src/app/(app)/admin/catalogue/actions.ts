"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/roles";

async function requireAdmin() {
  const ctx = await requireUser();
  if (!canAccessAdmin(ctx.profile.role)) throw new Error("Admins only");
  return ctx;
}

const festivalSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    region: z.string().trim().max(80).optional(),
  })
  .refine((v) => v.endDate >= v.startDate);

export async function addFestival(formData: FormData) {
  const parsed = festivalSchema.safeParse({
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    region: formData.get("region") || undefined,
  });
  if (!parsed.success) return;
  const { supabase } = await requireAdmin();
  await supabase.from("festivals").insert({
    name: parsed.data.name,
    start_date: parsed.data.startDate,
    end_date: parsed.data.endDate,
    region: parsed.data.region ?? null,
  });
  revalidatePath("/admin/catalogue");
}

export async function deleteFestival(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { supabase } = await requireAdmin();
  await supabase.from("festivals").delete().eq("id", id);
  revalidatePath("/admin/catalogue");
}

const airportSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  city: z.string().trim().min(2).max(60),
  name: z.string().trim().min(2).max(120),
});

export async function addAirport(formData: FormData) {
  const parsed = airportSchema.safeParse({
    code: formData.get("code"),
    city: formData.get("city"),
    name: formData.get("name"),
  });
  if (!parsed.success) return;
  const { supabase } = await requireAdmin();
  await supabase.from("airports").upsert(parsed.data, { onConflict: "code" });
  revalidatePath("/admin/catalogue");
}

export async function toggleAirport(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  const active = formData.get("active") === "true";
  const { supabase } = await requireAdmin();
  await supabase.from("airports").update({ active: !active }).eq("code", code);
  revalidatePath("/admin/catalogue");
}
