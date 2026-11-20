import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { formatRupees } from "@/lib/payments/money";
import { mockPay } from "@/app/payments/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Test payment · GroupFly" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPE_LABEL: Record<string, string> = {
  subscription: "Plan",
  deposit: "Refundable deposit",
  balance: "Fare balance",
};

/** Stand-in for a payment gateway's checkout page when PAYMENT_GATEWAY=mock. */
export default async function MockPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase } = await requireUser();
  const { data: pay } = await supabase
    .from("payments")
    .select("id, type, amount_paise, status, gateway, gateway_order_id")
    .eq("id", id)
    .maybeSingle();
  if (!pay || pay.gateway !== "mock") notFound();

  if (pay.status !== "created") {
    return (
      <div className="card mx-auto max-w-md space-y-3">
        <p className="font-semibold">This payment is already {pay.status}.</p>
        <Link href={`/payments/${pay.id}`} className="btn-ghost">See payment</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="rounded-lg border border-accent bg-accent/10 px-4 py-2 text-sm">
        <b>Test payment page.</b> This stands in for Razorpay while no gateway keys are set. No money moves.
      </div>
      <div className="card space-y-4">
        <div>
          <p className="text-sm text-muted">{TYPE_LABEL[pay.type] ?? pay.type}</p>
          <p className="text-3xl font-bold">{formatRupees(Number(pay.amount_paise))}</p>
          <p className="text-xs text-muted">Order {pay.gateway_order_id}</p>
        </div>
        <form action={mockPay} className="space-y-2">
          <input type="hidden" name="paymentId" value={pay.id} />
          <button type="submit" name="outcome" value="success" className="btn-primary w-full">
            Pay {formatRupees(Number(pay.amount_paise))} with test card
          </button>
          <button type="submit" name="outcome" value="failure" className="btn-danger w-full">
            Simulate a declined card
          </button>
        </form>
        <Link href="/payments" className="block text-center text-sm text-muted hover:underline">
          Cancel and go back
        </Link>
      </div>
    </div>
  );
}
