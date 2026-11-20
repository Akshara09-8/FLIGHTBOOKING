import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { formatRupees } from "@/lib/payments/money";
import { formatPaymentDate, PAYMENT_STATUS_LABELS, PAYMENT_TYPE_LABELS, paymentStatusClass } from "@/lib/payments/labels";
import { AutoRefresh } from "./AutoRefresh";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payment · GroupFly" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, user } = await requireUser();
  const { data: pay } = await supabase
    .from("payments")
    .select("id, type, status, amount_paise, created_at, paid_at, refunded_at, failure_reason, pool_id, plan, gateway, refund_requested_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!pay) notFound();

  const amount = formatRupees(Number(pay.amount_paise));
  const headline =
    pay.status === "succeeded"
      ? pay.type === "subscription"
        ? "Your plan is active"
        : pay.type === "deposit"
          ? "Deposit paid: your seats are confirmed"
          : pay.type === "refund"
            ? "Refund issued"
            : "Payment received"
      : pay.status === "refunded"
        ? "This payment was refunded"
        : pay.status === "failed"
          ? "The payment didn't go through"
          : "Waiting for the payment to be confirmed…";

  return (
    <div className="mx-auto max-w-lg space-y-4">
      {pay.status === "created" && <AutoRefresh />}
      <Link href="/payments" className="text-sm text-brand hover:underline">← All payments</Link>
      <div className="card space-y-4">
        <div>
          <p className={`text-sm font-semibold ${paymentStatusClass(pay.status)}`}>
            {PAYMENT_STATUS_LABELS[pay.status] ?? pay.status}
          </p>
          <h1 className="mt-1 text-xl font-bold">{headline}</h1>
        </div>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted">What</dt>
          <dd>{PAYMENT_TYPE_LABELS[pay.type] ?? pay.type}{pay.plan ? ` · ${pay.plan}` : ""}</dd>
          <dt className="text-muted">Amount</dt>
          <dd className="font-semibold">{amount}</dd>
          <dt className="text-muted">Started</dt>
          <dd>{formatPaymentDate(pay.created_at)} IST</dd>
          {pay.paid_at && (
            <>
              <dt className="text-muted">Paid</dt>
              <dd>{formatPaymentDate(pay.paid_at)} IST</dd>
            </>
          )}
          {pay.refunded_at && (
            <>
              <dt className="text-muted">Refunded</dt>
              <dd>{formatPaymentDate(pay.refunded_at)} IST</dd>
            </>
          )}
        </dl>
        {pay.status === "failed" && (
          <p className="text-sm text-muted">
            Nothing was charged{pay.failure_reason ? ` (${pay.failure_reason.replace(/_/g, " ").toLowerCase()})` : ""}. You
            can try again; held seats stay held until their deadline.
          </p>
        )}
        {pay.status === "created" && (
          <p className="text-sm text-muted">
            You can close this page. If the payment went through, it will be confirmed automatically.
          </p>
        )}
        {pay.status === "succeeded" && pay.refund_requested_at && (
          <p className="text-sm text-muted">A refund has been requested and is being processed.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {(pay.status === "succeeded" || pay.status === "refunded") && (
            <a href={`/api/receipts/${pay.id}`} className="btn-ghost" target="_blank" rel="noreferrer">
              Download receipt (PDF)
            </a>
          )}
          {pay.pool_id && (
            <Link href={`/pools/${pay.pool_id}`} className="btn-brand">Go to pool</Link>
          )}
          {pay.type === "subscription" && pay.status === "succeeded" && (
            <Link href="/pools" className="btn-brand">Find a pool</Link>
          )}
          {pay.type === "subscription" && pay.status === "failed" && (
            <Link href="/plans" className="btn-primary">Try again</Link>
          )}
        </div>
      </div>
    </div>
  );
}
