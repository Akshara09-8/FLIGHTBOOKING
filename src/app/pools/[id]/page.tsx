import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/SetupNotice";
import { CutOffCountdown } from "@/components/CutOffCountdown";
import { CopyLink } from "@/components/CopyLink";
import {
  canJoin,
  formatDateTimeIST,
  formatInr,
  formatTimeIST,
  formatTravelDate,
  POOL_SELECT,
  POOL_STATUS_LABELS,
  poolProgress,
  savings,
  TIME_WINDOW_LABELS,
  type Pool,
  type PoolWithRefs,
} from "@/lib/pools";
import { toRole } from "@/lib/roles";
import { LiveSeats } from "./LiveSeats";
import { JoinForm } from "./JoinForm";
import { LeaveForm } from "./LeaveForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pool · GroupFly" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Member = { traveller_id: string; status: "held" | "confirmed" | "waitlisted"; traveller: { full_name_as_on_id: string } | null };

export default async function PoolPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  if (!getSupabaseEnv()) return <SetupNotice />;
  const { id } = await params;
  const { code } = await searchParams;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: direct } = await supabase.from("pools").select(POOL_SELECT).eq("id", id).maybeSingle();
  let pool = direct as unknown as PoolWithRefs | null;

  // Private pool opened from an invite link by someone who isn't a member yet.
  if (!pool && code) {
    const { data: invited } = await supabase.rpc("get_invited_pool", { p_pool_id: id, p_invite_code: code });
    const row = (invited as Pool[] | null)?.[0];
    if (row) {
      const [{ data: festival }, { data: flight }] = await Promise.all([
        row.festival_id
          ? supabase.from("festivals").select("name").eq("id", row.festival_id).maybeSingle()
          : Promise.resolve({ data: null }),
        row.flight_id
          ? supabase.from("flights").select("airline, flight_no, departs_at, arrives_at").eq("id", row.flight_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      pool = { ...row, festival, flight } as PoolWithRefs;
    }
  }
  if (!pool) notFound();

  let role = toRole(undefined);
  let members: Member[] = [];
  let available: { id: string; name: string }[] = [];
  if (user) {
    const [{ data: profile }, { data: memberRows }, { data: travellerRows }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      supabase
        .from("pool_members")
        .select("traveller_id, status, traveller:travellers(full_name_as_on_id)")
        .eq("pool_id", pool.id)
        .eq("user_id", user.id)
        .neq("status", "left"),
      supabase.from("travellers").select("id, full_name_as_on_id").eq("user_id", user.id).order("is_self", { ascending: false }),
    ]);
    role = toRole(profile?.role);
    members = (memberRows ?? []) as unknown as Member[];
    const inPool = new Set(members.map((m) => m.traveller_id));
    available = (travellerRows ?? [])
      .filter((t) => !inPool.has(t.id))
      .map((t) => ({ id: t.id as string, name: t.full_name_as_on_id as string }));
  }

  const p = poolProgress(pool.seats_filled, pool.min_seats, pool.max_seats);
  const save = savings(pool.market_fare_paise, pool.target_fare_paise);
  const joinable = canJoin(pool);
  const isOwner = user && (pool.created_by === user.id || role === "admin");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const inviteUrl = pool.is_private && pool.invite_code ? `${proto}://${host}/pools/${pool.id}?code=${pool.invite_code}` : null;
  const nextPath = `/pools/${pool.id}${code ? `?code=${encodeURIComponent(code)}` : ""}`;
  const waitlisted = members.length > 0 && members.every((m) => m.status === "waitlisted");

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <section className="min-w-0 space-y-5">
        <Link href="/pools" className="text-sm text-brand hover:underline">← All pools</Link>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {pool.festival && <span className="chip">{pool.festival.name}</span>}
            {pool.is_private && <span className="chip">Private pool</span>}
            <span className="chip">{POOL_STATUS_LABELS[pool.status]}</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold">
            {pool.origin} → {pool.destination}
          </h1>
          <p className="text-muted">
            {formatTravelDate(pool.travel_date)} · {TIME_WINDOW_LABELS[pool.time_window]}
            {pool.flight &&
              ` · ${pool.flight.airline} ${pool.flight.flight_no}, departs ${formatTimeIST(pool.flight.departs_at)} IST`}
          </p>
        </div>

        <div className="card space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted">Typical festival fare</span>
            <span className="text-muted line-through">{formatInr(pool.market_fare_paise)}</span>
          </div>
          <div className="flex items-end justify-between">
            <span>Estimated group fare</span>
            <span className="text-2xl font-bold text-brand">{formatInr(pool.target_fare_paise)}</span>
          </div>
          {save && (
            <p className="text-sm font-semibold text-ok">
              You save about {formatInr(save.amountPaise)} per seat ({save.percent}%)
            </p>
          )}
          <p className="pt-1 text-xs text-muted">The final fare is confirmed when the airline quotes for the group.</p>
        </div>

        <div className="card">
          <LiveSeats poolId={pool.id} initialSeats={pool.seats_filled} minSeats={pool.min_seats} maxSeats={pool.max_seats} />
          <p className="mt-3 text-sm text-muted">
            {p.minReached
              ? "Minimum reached. We request the group fare from the airline after joining closes."
              : `${p.toMinimum} more seat${p.toMinimum === 1 ? "" : "s"} needed before we can request a group fare.`}
          </p>
        </div>

        <div className="card grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted">Joining closes</p>
            <p>
              <CutOffCountdown cutOffAt={pool.cut_off_at} />
            </p>
            <p className="text-xs text-muted">{formatDateTimeIST(pool.cut_off_at)}</p>
          </div>
          <div>
            <p className="text-muted">If the pool doesn&apos;t fill</p>
            <p>It closes and nothing is charged.</p>
          </div>
        </div>
      </section>

      <aside className="h-fit space-y-4">
        <div className="card space-y-4">
          {members.length > 0 && (
            <div>
              <p className="font-semibold">{waitlisted ? "Your group is on the waitlist" : "You're in this pool"}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {members.map((m) => (
                  <li key={m.traveller_id} className="flex justify-between">
                    <span>{m.traveller?.full_name_as_on_id}</span>
                    <span className="text-muted">{m.status === "waitlisted" ? "Waitlist" : "Seat held"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!user ? (
            <div className="space-y-2">
              <p className="font-semibold">Join this pool</p>
              <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="btn-primary w-full">
                Log in to join
              </Link>
            </div>
          ) : !joinable ? (
            <p className="text-sm text-muted">This pool is no longer taking new members.</p>
          ) : (
            <div className="space-y-2">
              {members.length > 0 && <p className="font-semibold">Add more travellers</p>}
              <JoinForm poolId={pool.id} code={code} travellers={available} seatsLeft={p.seatsLeft} />
            </div>
          )}

          {user && members.length > 0 && joinable && <LeaveForm poolId={pool.id} seatCount={members.length} />}
        </div>

        {isOwner && inviteUrl && (
          <div className="card space-y-2">
            <p className="font-semibold">Invite your group</p>
            <p className="text-sm text-muted">Only people with this link can see and join this pool.</p>
            <CopyLink url={inviteUrl} />
          </div>
        )}
      </aside>
    </div>
  );
}
