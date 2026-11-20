import Link from "next/link";
import { getSupabaseEnv } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { SetupNotice } from "@/components/SetupNotice";
import { formatRupees } from "@/lib/payments/money";
import { formatPaymentDate, PAYMENT_STATUS_LABELS, PAYMENT_TYPE_LABELS, paymentStatusClass } from "@/lib/payments/labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payments · GroupFly" };

type Row = {
  id: string;
  type: string;
  status: string;
  amount_paise: number;
  created_at: string;
  pool: { origin: string; destination: string } | null;
  plan: string | null;
};

export default async function PaymentsPage() {
  if (!getSupabaseEnv()) return <SetupNotice />;
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("payments")
    .select("id, type, status, amount_paise, created_at, plan, pool:pools(origin, destination)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Payments</h1>
          <p className="text-sm text-muted">Plans, deposits and refunds. Download a receipt for any completed payment.</p>
        </div>
        <Link href="/plans" className="btn-ghost">Plans</Link>
      </div>
      {rows.length === 0 ? (
        <p className="card text-sm text-muted">No payments yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Date (IST)</th>
                <th className="px-4 py-2 font-medium">What</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums">{formatPaymentDate(r.created_at)}</td>
                  <td className="px-4 py-2">
                    <Link href={`/payments/${r.id}`} className="text-brand hover:underline">
                      {PAYMENT_TYPE_LABELS[r.type] ?? r.type}
                    </Link>
                    <span className="text-muted">
                      {r.pool ? ` · ${r.pool.origin} → ${r.pool.destination}` : r.plan ? ` · ${r.plan}` : ""}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.type === "refund" ? "−" : ""}
                    {formatRupees(Number(r.amount_paise))}
                  </td>
                  <td className={`px-4 py-2 ${paymentStatusClass(r.status)}`}>{PAYMENT_STATUS_LABELS[r.status] ?? r.status}</td>
                  <td className="px-4 py-2">
                    {r.status === "succeeded" || r.status === "refunded" ? (
                      <a href={`/api/receipts/${r.id}`} className="text-brand hover:underline" target="_blank" rel="noreferrer">
                        PDF
                      </a>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
