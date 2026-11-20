import { NextResponse, type NextRequest } from "next/server";
import { adminRouteClient, UUID_RE } from "@/lib/admin-route";
import { paxMix } from "@/lib/ops";
import { buildRfqPdf } from "@/lib/ops-pdf";
import { formatTimeIST, TIME_WINDOW_LABELS, type TimeWindow } from "@/lib/pools";

/** The fare request letter (PDF) for a logged RFQ (T4.2). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; rfqId: string }> }) {
  const { id, rfqId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(rfqId)) return new NextResponse("Not found", { status: 404 });
  const ctx = await adminRouteClient();
  if (!ctx) return new NextResponse("Admins only", { status: 403 });
  const { supabase, email } = ctx;

  const [{ data: rfq }, { data: pool }, { data: members }] = await Promise.all([
    supabase.from("rfqs").select("airline, seats, target_fare_paise, sent_at").eq("id", rfqId).eq("pool_id", id).maybeSingle(),
    supabase
      .from("pools")
      .select("origin, destination, travel_date, time_window, flight:flights(airline, flight_no, departs_at)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("pool_members").select("traveller:travellers(date_of_birth)").eq("pool_id", id).eq("status", "confirmed"),
  ]);
  if (!rfq || !pool) return new NextResponse("Not found", { status: 404 });

  const flight = pool.flight as unknown as { airline: string; flight_no: string; departs_at: string } | null;
  const dobs = ((members ?? []) as unknown as { traveller: { date_of_birth: string } | null }[])
    .filter((m) => m.traveller)
    .map((m) => ({ dateOfBirth: m.traveller!.date_of_birth }));
  const sentOn = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(
    new Date(rfq.sent_at as string),
  );
  const replyBy = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(
    new Date(new Date(rfq.sent_at as string).getTime() + 3 * 86_400_000),
  );

  const pdf = await buildRfqPdf(
    {
      airline: rfq.airline as string,
      origin: pool.origin as string,
      destination: pool.destination as string,
      travelDate: pool.travel_date as string,
      timeWindowLabel: TIME_WINDOW_LABELS[pool.time_window as TimeWindow],
      flight: flight ? { airline: flight.airline, flight_no: flight.flight_no, departsAtIST: formatTimeIST(flight.departs_at) } : null,
      seats: Number(rfq.seats),
      mix: paxMix(dobs, pool.travel_date as string),
      targetFareRupees: rfq.target_fare_paise != null ? Math.round(Number(rfq.target_fare_paise) / 100) : null,
      replyBy,
      contactEmail: email,
    },
    sentOn,
  );
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="fare-request-${pool.origin}-${pool.destination}-${pool.travel_date}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
