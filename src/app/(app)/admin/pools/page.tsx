import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/roles";
import { formatTravelDate, POOL_STATUS_LABELS, type PoolStatus } from "@/lib/pools";
import { formatRupees } from "@/lib/payments/money";
import { formatPaymentDate } from "@/lib/payments/labels";
import { DissolveForm } from "./DissolveForm";
import { retryRefund } from "./actions";

export const metadata = { title: "Pools · Admin · GroupFly" };

type PoolRow = {
  id: string;
  origin: string;
  destination: string;
  travel_date: string;
  status: PoolStatus;
  seats_filled: number;
  min_seats: number;
  max_seats: number;
  is_private: boolean;
};
type PendingRefund = { id: string; amount_paise: number; refund_requested_at: string; user_id: string; pool_id: string | null };

export default async function AdminPoolsPage() {
  const { supabase, profile } = await requireUser();
  if (!canAccessAdmin(profile.role)) {
    return (
      <div className="card max-w-lg">
        <p className="text-sm font-semibold text-danger">403 · Admins only</p>
        <Link href="/dashboard" className="btn-ghost mt-4">Back to dashboard</Link>
      </div>
    );
  }

  const [{ data: pools }, { data: pending }, { data: deposits }] = await Promise.all([
    supabase
      .from("pools")
      .select("id, origin, destination, travel_date, status, seats_filled, min_seats, max_seats, is_private")
      .order("travel_date"),
    supabase
      .from("payments")
      .select("id, amount_paise, refund_requested_at, user_id, pool_id")
      .eq("status", "succeeded")
      .not("refund_requested_at", "is", null)
      .order("refund_requested_at"),
    supabase.from("payments").select("pool_id, amount_paise").eq("type", "deposit").eq("status", "succeeded"),
  ]);

  const held = new Map<string, number>();
  for (const d of deposits ?? []) {
    if (d.pool_id) held.set(d.pool_id as string, (held.get(d.pool_id as string) ?? 0) + Number(d.amount_paise));
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin" className="text-sm text-brand hover:underline">← Admin</Link>
          <h1 className="mt-1 text-2xl font-bold">Pools and deposits</h1>
        </div>
        <Link href="/pools/new" className="btn-brand">Create a pool</Link>
      </div>

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
              <th className="px-4 py-2 text-right font-medium">Deposits held</th>
              <th className="px-4 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {((pools ?? []) as PoolRow[]).map((p) => {
              const label = `${p.origin} → ${p.destination}`;
              return (
                <tr key={p.id}>
                  <td className="px-4 py-2">
                    <Link href={`/pools/${p.id}`} className="text-brand hover:underline">{label}</Link>
                    <span className="text-muted"> · {formatTravelDate(p.travel_date)}{p.is_private ? " · private" : ""}</span>
                  </td>
                  <td className="px-4 py-2">{POOL_STATUS_LABELS[p.status]}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {p.seats_filled}/{p.max_seats} <span className="text-muted">(min {p.min_seats})</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatRupees(held.get(p.id) ?? 0)}</td>
                  <td className="px-4 py-2">
                    {p.status === "dissolved" || p.status === "ticketed" || p.status === "completed" ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <DissolveForm poolId={p.id} label={label} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
