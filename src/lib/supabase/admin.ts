import { createClient } from "@supabase/supabase-js";
import { requireSupabaseEnv } from "@/lib/env";

/**
 * Service-role client: bypasses row-level security. Server code only, used for
 * payment records, webhooks and refunds. Never import this from a client component.
 */
export function createAdminClient() {
  const { url } = requireSupabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing. Add it to .env.local (Project Settings -> API).");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
