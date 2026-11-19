import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

export const metadata: Metadata = {
  title: "GroupFly",
  description: "Festival group flights: pool 30-40 travellers and pay the group fare.",
};

async function currentUserEmail(): Promise<string | null> {
  if (!getSupabaseEnv()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const email = await currentUserEmail();
  return (
    <html lang="en-IN">
      <body className="min-h-screen">
        <header className="bg-brand text-white">
          <nav className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href={email ? "/dashboard" : "/"} className="text-lg font-bold tracking-tight">
              Group<span className="text-accent">Fly</span>
            </Link>
            {email ? (
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <Link href="/pools" className="hover:underline">Pools</Link>
                <Link href="/dashboard" className="hover:underline">Dashboard</Link>
                <Link href="/travellers" className="hover:underline">Travellers</Link>
                <Link href="/profile" className="hover:underline">Profile</Link>
                <form action={signOut}>
                  <button type="submit" className="rounded-md border border-white/40 px-3 py-1 hover:bg-white/10">
                    Log out
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex items-center gap-4 text-sm">
                <Link href="/pools" className="hover:underline">Browse pools</Link>
                <Link href="/login" className="rounded-md bg-accent px-3 py-1.5 font-semibold text-accent-ink">
                  Log in
                </Link>
              </div>
            )}
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
