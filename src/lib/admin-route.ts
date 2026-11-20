import { getSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** For API routes: the signed-in admin's client, or null. */
export async function adminRouteClient() {
  if (!getSupabaseEnv()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role, email").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return null;
  return { supabase, user, email: (profile.email as string | null) ?? user.email ?? "" };
}
