import { NextResponse, type NextRequest } from "next/server";
import { adminRouteClient, UUID_RE } from "@/lib/admin-route";
import { MANIFEST_HEADER, manifestRows, toCsv, type ManifestPassenger } from "@/lib/ops";

type Row = {
  traveller_id: string;
  traveller: { full_name_as_on_id: string; date_of_birth: string; gender: ManifestPassenger["gender"] } | null;
};

/** Passenger list for the airline: confirmed passengers only, names exactly as on ID (T4.4). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return new NextResponse("Not found", { status: 404 });
  const ctx = await adminRouteClient();
  if (!ctx) return new NextResponse("Admins only", { status: 403 });
  const { supabase, user } = ctx;

  const [{ data: pool }, { data: members }, { data: tickets }] = await Promise.all([
    supabase.from("pools").select("origin, destination, travel_date, status").eq("id", id).maybeSingle(),
    supabase
      .from("pool_members")
      .select("traveller_id, traveller:travellers(full_name_as_on_id, date_of_birth, gender)")
      .eq("pool_id", id)
      .eq("status", "confirmed"),
    supabase.from("tickets").select("traveller_id, pnr, ticket_number").eq("pool_id", id),
  ]);
  if (!pool) return new NextResponse("Not found", { status: 404 });

  const byTraveller = new Map((tickets ?? []).map((t) => [t.traveller_id as string, t]));
  const passengers: ManifestPassenger[] = ((members ?? []) as unknown as Row[])
    .filter((m) => m.traveller)
    .map((m) => ({
      fullNameAsOnId: m.traveller!.full_name_as_on_id,
      dateOfBirth: m.traveller!.date_of_birth,
      gender: m.traveller!.gender,
      pnr: (byTraveller.get(m.traveller_id)?.pnr as string | null) ?? null,
      ticketNumber: (byTraveller.get(m.traveller_id)?.ticket_number as string | null) ?? null,
    }));

  const csv = toCsv([[...MANIFEST_HEADER], ...manifestRows(passengers, pool.travel_date as string)]);
  await supabase.from("audit_log").insert({
    actor_id: user.id,
    action: "export_manifest",
    entity: "pools",
    entity_id: id,
    after: { passengers: passengers.length, status: pool.status },
  });

  const name = `manifest-${pool.origin}-${pool.destination}-${pool.travel_date}.csv`;
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
