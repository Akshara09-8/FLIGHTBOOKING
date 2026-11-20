import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canAccessAdmin, ROLE_LABELS } from "@/lib/roles";
import { formatTravelDate, POOL_STATUS_LABELS, type PoolStatus } from "@/lib/pools";
import { SeatMeter } from "@/components/SeatMeter";
import { getActivePlan } from "@/lib/subscription";

export const metadata = { title: "Dashboard · GroupFly" };

type Festival = { id: string; name: string; start_date: string; end_date: string; region: string | null };
type PoolSummary = {
  id: string;
  origin: string;
  destination: string;
  travel_date: string;
  status: PoolStatus;
  seats_filled: number;
  min_seats: number;
  max_seats: number;
};
type MemberRow = { status: string; pool: PoolSummary | null };
type MyPool = PoolSummary & { seats: number; waitlisted: number };

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function DashboardPage() {
  const { supabase, profile } = await requireUser();

  const [{ count: travellerCount }, { data: festivals }, { data: memberRows }] = await Promise.all([
    supabase.from("travellers").select("id", { count: "exact", head: true }).eq("user_id", profile.id),
    supabase.from("festivals").select("id, name, start_date, end_date, region").order("start_date").limit(5),
    supabase
      .from("pool_members")
      .select("status, pool:pools(id, origin, destination, travel_date, status, seats_filled, min_seats, max_seats)")
      .eq("user_id", profile.id)
      .neq("status", "left"),
  ]);

  // One entry per pool, with how many of the user's travellers are in it.
  const myPools = new Map<string, MyPool>();
  for (const row of (memberRows ?? []) as unknown as MemberRow[]) {
    if (!row.pool) continue;
    const entry = myPools.get(row.pool.id) ?? { ...row.pool, seats: 0, waitlisted: 0 };
    if (row.status === "waitlisted") entry.waitlisted += 1;
    else entry.seats += 1;
    myPools.set(row.pool.id, entry);
  }
  const pools = [...myPools.values()].sort((a, b) => a.travel_date.localeCompare(b.travel_date));
  const activePlan = await getActivePlan(supabase, profile.id);

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href={activePlan ? "/payments" : "/plans"} className={`card hover:border-brand ${activePlan ? "" : "border-accent"}`}>
          <p className="text-sm text-muted">Plan</p>
          {activePlan ? (
            <>
              <p className="mt-1 font-semibold">{activePlan.planName}</p>
              <p className="text-sm text-muted">
                Active until{" "}
                {new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(
                  new Date(activePlan.endsAt),
                )}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 font-semibold">No active plan</p>
              <p className="text-sm text-muted">Get a plan to join pools</p>
            </>
          )}
        </Link>
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
          <Link href="/pools" className="card hover:border-brand">
            <p className="text-sm text-muted">Group pools</p>
            <p className="mt-1 font-semibold">Find a pool</p>
            <p className="text-sm text-muted">Search festival routes and join a group.</p>
          </Link>
        )}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">My pools</h2>
          <Link href="/pools" className="text-sm text-brand hover:underline">Find more</Link>
        </div>
        {pools.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {pools.map((p) => (
              <Link key={p.id} href={`/pools/${p.id}`} className="card space-y-3 hover:border-brand">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{p.origin} → {p.destination}</p>
                    <p className="text-sm text-muted">{formatTravelDate(p.travel_date)}</p>
                  </div>
                  <span className="chip">{POOL_STATUS_LABELS[p.status]}</span>
                </div>
                <SeatMeter seatsFilled={p.seats_filled} minSeats={p.min_seats} maxSeats={p.max_seats} size="sm" />
                <p className="text-sm">
                  {p.seats > 0 && `${p.seats} seat${p.seats > 1 ? "s" : ""}`}
                  {p.seats > 0 && p.waitlisted > 0 && " · "}
                  {p.waitlisted > 0 && <span className="text-danger">{p.waitlisted} on waitlist</span>}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="card text-sm text-muted">
            You haven&apos;t joined a pool yet. <Link href="/pools" className="text-brand underline">Browse pools</Link>
          </p>
        )}
      </section>

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
