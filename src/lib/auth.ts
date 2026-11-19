import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { toRole, type Role } from "@/lib/roles";

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: Role;
};

/** Signed-in user + profile, or a redirect to /login. Server-side only. */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, phone, role")
    .eq("id", user.id)
    .single();

  const profile: Profile = {
    id: user.id,
    email: data?.email ?? user.email ?? null,
    full_name: data?.full_name ?? null,
    phone: data?.phone ?? null,
    role: toRole(data?.role),
  };
  return { supabase, user, profile };
}
