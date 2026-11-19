import { createBrowserClient } from "@supabase/ssr";

/** Supabase client for client components (used for the live seat counter). */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
