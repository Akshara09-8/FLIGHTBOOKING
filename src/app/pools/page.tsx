import Link from "next/link";
import { getSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/SetupNotice";
import { PoolCard } from "@/components/PoolCard";
import {
  JOINABLE_STATUSES,
  POOL_SELECT,
  TIME_WINDOWS,
  TIME_WINDOW_LABELS,
  formatTravelDate,
  searchDateRange,
  searchSchema,
  type PoolWithRefs,
} from "@/lib/pools";
import { toRole, canCreatePrivatePool } from "@/lib/roles";
import { createAlert } from "./actions";

export const metadata = { title: "Find a group pool · GroupFly" };
export const dynamic = "force-dynamic";

type Airport = { code: string; city: string };
type Festival = { id: string; name: string };
type Params = { from?: string; to?: string; date?: string; window?: string; flexible?: string; festival?: string; alert?: string };

export default async function PoolsPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!getSupabaseEnv()) return <SetupNotice />;
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: airportRows }, { data: festivalRows }, { data: auth }] = await Promise.all([
    supabase.from("airports").select("code, city").eq("active", true).order("city"),
    supabase.from("festivals").select("id, name").gte("end_date", new Date().toISOString().slice(0, 10)).order("start_date"),
    supabase.auth.getUser(),
  ]);
  const airports = (airportRows ?? []) as Airport[];
  const festivals = (festivalRows ?? []) as Festival[];
  const user = auth.user;

  let role = toRole(undefined);
  if (user) {
    const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    role = toRole(data?.role);
  }

  const searched = Boolean(params.from || params.to);
  const parsed = searched ? searchSchema.safeParse(params) : null;
  const searchError = parsed && !parsed.success ? parsed.error.issues[0]?.message : undefined;
  const nowIso = new Date().toISOString();
  const festivalId = params.festival && /^[0-9a-f-]{36}$/i.test(params.festival) ? params.festival : undefined;

  let pools: PoolWithRefs[] = [];
  if (parsed?.success) {
    const s = parsed.data;
    let q = supabase
      .from("pools")
      .select(POOL_SELECT)
      .eq("origin", s.from)
      .eq("destination", s.to)
      .in("status", JOINABLE_STATUSES)
      .gt("cut_off_at", nowIso)
      .order("travel_date")
      .order("seats_filled", { ascending: false });
    if (s.date) {
      const range = searchDateRange(s.date, s.flexible);
      q = q.gte("travel_date", range.from).lte("travel_date", range.to);
    }
    if (s.window) q = q.eq("time_window", s.window);
    if (festivalId) q = q.eq("festival_id", festivalId);
    const { data } = await q.limit(50);
    pools = (data ?? []) as unknown as PoolWithRefs[];
  } else if (!searched) {
    let q = supabase
      .from("pools")
      .select(POOL_SELECT)
      .eq("is_private", false)
      .in("status", JOINABLE_STATUSES)
      .gt("cut_off_at", nowIso)
      .order("seats_filled", { ascending: false });
    if (festivalId) q = q.eq("festival_id", festivalId);
    const { data } = await q.limit(9);
    pools = (data ?? []) as unknown as PoolWithRefs[];
  }

  const s = parsed?.success ? parsed.data : undefined;
  const cityOf = (code: string) => airports.find((a) => a.code === code)?.city ?? code;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Find a group pool</h1>
        <p className="text-sm text-muted">Pools fill with 30–40 people on the same route, day and time window.</p>
      </div>

      <form method="get" className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-6" role="search">
        <div className="lg:col-span-1">
          <label htmlFor="from" className="label">From</label>
          <select id="from" name="from" defaultValue={params.from ?? ""} className="input" required>
            <option value="" disabled>City</option>
            {airports.map((a) => (
              <option key={a.code} value={a.code}>{a.city} ({a.code})</option>
            ))}
          </select>
        </div>
        <div className="lg:col-span-1">
          <label htmlFor="to" className="label">To</label>
          <select id="to" name="to" defaultValue={params.to ?? ""} className="input" required>
            <option value="" disabled>City</option>
            {airports.map((a) => (
              <option key={a.code} value={a.code}>{a.city} ({a.code})</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="date" className="label">Date</label>
          <input id="date" name="date" type="date" defaultValue={params.date ?? ""} className="input" />
        </div>
        <div>
          <label htmlFor="window" className="label">Time</label>
          <select id="window" name="window" defaultValue={params.window ?? ""} className="input">
            <option value="">Any time</option>
            {TIME_WINDOWS.map((w) => (
              <option key={w} value={w}>{TIME_WINDOW_LABELS[w]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="festival" className="label">Festival</label>
          <select id="festival" name="festival" defaultValue={festivalId ?? ""} className="input">
            <option value="">Any</option>
            {festivals.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="flexible" value="1" defaultChecked={params.flexible === "1"} className="h-4 w-4 accent-brand" />
            ±1 day
          </label>
          <button type="submit" className="btn-primary">Search</button>
        </div>
      </form>

      {searchError && <p className="field-error" role="alert">{searchError}</p>}
      {params.alert === "1" && (
        <p className="rounded-lg bg-brand-soft px-4 py-2 text-sm text-brand" role="status">
          Done. We&apos;ll email you when a pool opens on this route.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          {s
            ? `${cityOf(s.from)} → ${cityOf(s.to)}${s.date ? ` · ${formatTravelDate(s.date)}${s.flexible ? " ±1 day" : ""}` : ""}`
            : "Filling fast"}
        </h2>

        {pools.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pools.map((p) => (
              <PoolCard key={p.id} pool={p} />
            ))}
          </div>
        ) : s ? (
          <div className="card space-y-3">
            <p className="font-medium">No open pools on this route{s.date ? " for that date" : ""} yet.</p>
            {user && s.date ? (
              <form action={createAlert} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="origin" value={s.from} />
                <input type="hidden" name="destination" value={s.to} />
                <input type="hidden" name="travelDate" value={s.date} />
                <button type="submit" className="btn-brand">Email me when a pool opens</button>
              </form>
            ) : user ? (
              <p className="text-sm text-muted">Pick a date to get an alert when a pool opens.</p>
            ) : (
              <p className="text-sm text-muted">
                <Link href="/login?next=/pools" className="text-brand underline">Log in</Link> to get an alert when a pool
                opens.
              </p>
            )}
            {canCreatePrivatePool(role) && (
              <Link href="/pools/new" className="btn-ghost">Start a private pool for your group</Link>
            )}
          </div>
        ) : !searched ? (
          <p className="text-sm text-muted">No open pools right now. Check back closer to the festival season.</p>
        ) : null}
      </section>
    </div>
  );
}
