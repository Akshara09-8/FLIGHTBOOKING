import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { UUID_RE } from "@/lib/admin-route";

const TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg" };

/**
 * E-ticket download. Row-level security decides who may see the ticket row
 * (its passenger's account, or an admin); only then is the private file read (T4.5).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getSupabaseEnv() || !UUID_RE.test(id)) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Log in to download tickets", { status: 401 });

  const { data: ticket } = await supabase.from("tickets").select("file_path, pnr").eq("id", id).maybeSingle();
  if (!ticket?.file_path) return new NextResponse("Not found", { status: 404 });

  const { data: file, error } = await createAdminClient().storage.from("tickets").download(ticket.file_path as string);
  if (error || !file) return new NextResponse("File missing", { status: 404 });

  const ext = (ticket.file_path as string).split(".").pop() ?? "pdf";
  return new NextResponse(Buffer.from(await file.arrayBuffer()), {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="e-ticket-${ticket.pnr ?? "groupfly"}.${ext}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
