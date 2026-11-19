import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canAccessAdmin, ROLE_LABELS } from "@/lib/roles";

export const metadata = { title: "Dashboard · GroupFly" };

type Festival = { id: string; name: string; start_date: string; end_date: string; region: string | null };

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function DashboardPage() {
  const { supabase, profile } = await requireUser();

  const [{ count: travellerCount }, { data: festivals }] = await Promise.all([
    supabase.from("travellers").select("id", { count: "exact", head: true }).eq("user_id", profile.id),
    supabase.from("festivals").select("id, name, start_date, end_date, region").order("start_date").limit(5),
  ]);

  const firstName = profile.full_name?.split(" ")[0];
  const needsProfile = !profile.full_name;
  const needsTravellers = (travellerCount ?? 0) === 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{firstName ? `Welcome, ${firstName}` : "Welcome to GroupFly"}</h1>
          <p className="text-sm text-muted">{profile.email}</p>
        </div>
        <span className="chip">{ROLE_LABELS[profile.role]}</span>
      </div>

      {(needsProfile || needsTravellers) && (
        <div className="card border-accent">
          <h2 className="font-semibold">Finish setting up</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {needsProfile && (
              <li>
                <Link href="/profile" className="text-brand underline">Add your name and phone</Link> so the group
                organiser can reach you.
              </li>
            )}
            {needsTravellers && (
              <li>
                <Link href="/travellers" className="text-brand underline">Add travellers</Link> (yourself and family)
                with names exactly as on ID.
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/travellers" className="card hover:border-brand">
          <p className="text-sm text-muted">Saved travellers</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{travellerCount ?? 0}</p>
        </Link>
        <Link href="/profile" className="card hover:border-brand">
          <p className="text-sm text-muted">Profile</p>
          <p className="mt-1 font-semibold">{profile.full_name ?? "Not set"}</p>
          <p className="text-sm text-muted">{profile.phone ?? "No phone yet"}</p>
        </Link>
        {canAccessAdmin(profile.role) ? (
          <Link href="/admin" className="card hover:border-brand">
            <p className="text-sm text-muted">Admin</p>
            <p className="mt-1 font-semibold">Users and roles</p>
          </Link>
        ) : (
          <div className="card">
            <p className="text-sm text-muted">Group pools</p>
            <p className="mt-1 font-semibold">Coming soon</p>
            <p className="text-sm text-muted">Search and join pools arrives in the next release.</p>
          </div>
        )}
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Upcoming festivals</h2>
        {festivals && festivals.length > 0 ? (
          <ul className="divide-y divide-line rounded-xl border border-line bg-white">
            {(festivals as Festival[]).map((f) => (
              <li key={f.id} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm">
                <span className="font-medium">{f.name}</span>
                <span className="text-muted">
                  {fmt(f.start_date)} – {fmt(f.end_date)}
                  {f.region ? ` · ${f.region}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No festivals yet. Run supabase/seed.sql to add demo data.</p>
        )}
      </section>
    </div>
  );
}
