import Link from "next/link";
import { getSupabaseEnv } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { SetupNotice } from "@/components/SetupNotice";
import { canCreatePrivatePool } from "@/lib/roles";
import { CreatePoolForm } from "./CreatePoolForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create a pool · GroupFly" };

export default async function NewPoolPage() {
  if (!getSupabaseEnv()) return <SetupNotice />;
  const { supabase, profile } = await requireUser();

  if (!canCreatePrivatePool(profile.role)) {
    return (
      <div className="card max-w-lg">
        <h1 className="text-xl font-bold">Pool organisers only</h1>
        <p className="mt-2 text-sm text-muted">
          Organisers can start private pools for their family, college or company. Ask an admin to make you an
          organiser, or join an existing pool.
        </p>
        <Link href="/pools" className="btn-ghost mt-4">Browse pools</Link>
      </div>
    );
  }

  const [{ data: airports }, { data: festivals }] = await Promise.all([
    supabase.from("airports").select("code, city").eq("active", true).order("city"),
    supabase.from("festivals").select("id, name").gte("end_date", new Date().toISOString().slice(0, 10)).order("start_date"),
  ]);

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">{profile.role === "admin" ? "Create a pool" : "Start a private pool"}</h1>
      <CreatePoolForm
        isAdmin={profile.role === "admin"}
        airports={(airports ?? []).map((a) => ({ value: a.code as string, label: `${a.city} (${a.code})` }))}
        festivals={(festivals ?? []).map((f) => ({ value: f.id as string, label: f.name as string }))}
      />
    </div>
  );
}
