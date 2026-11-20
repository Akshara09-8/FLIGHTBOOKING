import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { buildReceiptPdf, receiptContent } from "@/lib/payments/receipt";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PDF receipt for the signed-in user's own completed payment. Row-level security keeps others' receipts out. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getSupabaseEnv() || !UUID.test(id)) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Log in to download receipts", { status: 401 });

  const { data: pay } = await supabase
    .from("payments")
    .select(
      "id, type, status, amount_paise, paid_at, gateway, gateway_payment_id, gateway_refund_id, party_id, plan, refund_of, pool:pools(origin, destination, travel_date), plan_row:plans(name)",
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!pay || (pay.status !== "succeeded" && pay.status !== "refunded")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const [{ data: profile }, { count: seats }] = await Promise.all([
    supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
    pay.party_id
      ? supabase.from("pool_members").select("id", { count: "exact", head: true }).eq("party_id", pay.party_id)
      : Promise.resolve({ count: null }),
  ]);

  const data = {
    paymentId: pay.id as string,
    type: pay.type as "subscription" | "deposit" | "balance" | "refund",
    status: pay.status as string,
    amountPaise: Number(pay.amount_paise),
    paidAt: pay.paid_at as string | null,
    planName: (pay.plan_row as unknown as { name: string } | null)?.name ?? (pay.plan as string | null),
    customerName: profile?.full_name ?? null,
    customerEmail: profile?.email ?? user.email ?? null,
    gatewayRef: ((pay.type === "refund" ? pay.gateway_refund_id : pay.gateway_payment_id) as string | null) ?? null,
    gateway: pay.gateway as string,
    pool: pay.pool as unknown as { origin: string; destination: string; travel_date: string } | null,
    seats: seats ?? null,
  };

  const pdf = await buildReceiptPdf(data);
  const { number } = receiptContent(data);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
