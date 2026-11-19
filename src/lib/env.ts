export type SupabaseEnv = { url: string; anonKey: string };

/** Returns the Supabase settings, or null when .env.local has not been filled in yet. */
export function getSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || url.includes("your-project-ref")) return null;
  return { url, anonKey };
}

export function requireSupabaseEnv(): SupabaseEnv {
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and add your project URL and anon key.",
    );
  }
  return env;
}
