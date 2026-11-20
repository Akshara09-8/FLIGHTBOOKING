import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/roles";
import { formatTravelDate, POOL_STATUS_LABELS, type PoolStatus } from "@/lib/pools";
import { daysUntil, fillRate, nextAction, OPS_STATUS_LABELS, summarizePools, type OpsPool } from "@/lib/ops";
import { formatRupees } from "@/lib/payments/money";
import { formatPaymentDate } from "@/lib/payments/labels";
import { retryRefund } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operations · Admin · GroupFly" };

type PoolRow = OpsPool & {
  origin: string;
  destination: string;
  is_private: boolean;
  festival_id: string | null;
  festival: { name: string } | null;
};
type PendingRefund = { id: string; amount_paise: number; refund_requested_at: string };

const STATUS_ORDER: PoolStatus[] = [
  "open",
  "min_reached",
  "rfq_sent",
  "quoted",
  "payment_due",
  "names_submitted",
  "ticketed",
  "completed",
  "dissolved",
];

const label = (s: PoolStatus) => OPS_STATUS_LABELS[s] ?? POOL_STATUS_LABELS[s];

export default async function OpsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; festival?: string; q?: string }>;
}) {
  const { supabase, profile } = await requireUser();
  if (!canAccessAdmin(profile.role)) {
    return (
      <div className="card max-w-lg">
        <p className="text-sm font-semibold text-danger">403 · Admins only</p>
        <Link href="/dashboard" className="btn-ghost mt-4">Back to dashboard</Link>
      </div>
    );
  }
  const params = await searchParams;

  const [{ data: poolRows }, { data: festivals }, { data: pending }, { data: deposits }] = await Promise.all([
    supabase
      .from("pools")
      .select(
        "id, origin, destination, travel_date, status, seats_filled, min_seats, max_seats, cut_off_at, is_private, festival_id, festival:festivals(name)",
      )
      .order("travel_date"),
    supabase.from("festivals").select("id, name").order("start_date"),
    supabase
      .from("payments")
      .select("id, amount_paise, refund_requested_at")
      .eq("status", "succeeded")
      .not("refund_requested_at", "is", null)
      .order("refund_requested_at"),
    supabase.from("payments").select("pool_id, amount_paise").in("type", ["deposit", "balance"]).eq("status", "succeeded"),
  ]);

  const all = (poolRows ?? []) as unknown as PoolRow[];
  const q = (params.q ?? "").trim().toUpperCase();
  const pools = all.filter(
    (p) =>
      (!params.status || p.status === params.status) &&
      (!params.festival || p.festival_id === params.festival) &&
      (!q || `${p.origin}-${p.destination}`.includes(q) || p.origin === q || p.destination === q),
  );
  const summary = summarizePools(pools);
  const collected = new Map<string, number>();
  for (const d of deposits ?? []) {
    if (d.pool_id) collected.set(d.pool_id as string, (collected.get(d.pool_id as string) ?? 0) + Number(d.amount_paise));
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin" className="text-sm text-brand hover:underline">← Admin</Link>
          <h1 className="mt-1 text-2xl font-bold">Operations</h1>
        </div>
        <Link href="/pools/new" className="btn-brand">Create a pool</Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Pools shown", summary.total],
          ["Ready for fare request", summary.readyForRfq],
          ["Joining closes within 7 days", summary.closingSoon],
          ["Average fill (active)", `${summary.averageFill}%`],
        ].map(([k, v]) => (
          <div key={k} className="card">
            <p className="text-sm text-muted">{k}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{v}</p>
          </div>
        ))}
      </div>

      <form method="get" className="card grid gap-3 sm:grid-cols-4">
        <select name="status" defaultValue={params.status ?? ""} className="input" aria-label="Status">
          <option value="">All statuses</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {label(s)} ({all.filter((p) => p.status === s).length})
            </option>
          ))}
        </select>
        <select name="festival" defaultValue={params.festival ?? ""} className="input" aria-label="Festival">
          <option value="">All festivals</option>
          {(festivals ?? []).map((f) => (
            <option key={f.id as string} value={f.id as string}>{f.name as string}</option>
          ))}
        </select>
        <input name="q" defaultValue={params.q ?? ""} placeholder="Route or airport, e.g. DEL-PAT" className="input" aria-label="Route" />
        <button type="submit" className="btn-ghost">Filter</button>
      </form>

      {(pending ?? []).length > 0 && (
        <section className="card space-y-3 border-danger/40">
          <h2 className="font-semibold">Refunds waiting for a retry</h2>
          <ul className="divide-y divide-line text-sm">
            {((pending ?? []) as PendingRefund[]).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {formatRupees(Number(r.amount_paise))} · requested {formatPaymentDate(r.refund_requested_at)} IST
                </span>
                <form action={retryRefund}>
                  <input type="hidden" name="paymentId" value={r.id} />
                  <button type="submit" className="btn-ghost py-1">Retry refund</button>
                </form>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">A refund can be retried 10 minutes after the last attempt.</p>
        </section>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-canvas text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Pool</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Seats</th>
              <th className="px-4 py-2 text-right font-medium">Joining closes</th>
              <th className="px-4 py-2 text-right font-medium">Collected</th>
              <th className="px-4 py-2 font-medium">Next step</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {pools.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">No pools match these filters.</td>
              </tr>
            )}
            {pools.map((p) => {
              const days = daysUntil(p.cut_off_at);
              return (
                <tr key={p.id}>
                  <td className="px-4 py-2">
                    <Link href={`/admin/pools/${p.id}`} className="font-medium text-brand hover:underline">
                      {p.origin} → {p.destination}
                    </Link>
                    <span className="text-muted">
                      {" "}· {formatTravelDate(p.travel_date)}
                      {p.festival ? ` · ${p.festival.name}` : ""}
                      {p.is_private ? " · private" : ""}
                    </span>
                  </td>
                  <td className="px-4 py-2">{label(p.status)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {p.seats_filled}/{p.max_seats} <span className="text-muted">({fillRate(p)}%)</span>
                  </td>
                  <td className={`px-4 py-2 text-right tabular-nums ${days >= 0 && days < 7 ? "font-semibold text-danger" : ""}`}>
                    {days < 0 ? "Closed" : days === 0 ? "Today" : `${days} days`}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatRupees(collected.get(p.id) ?? 0)}</td>
                  <td className="px-4 py-2 text-muted">{nextAction(p.status)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
