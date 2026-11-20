import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canAccessAdmin, ROLES, ROLE_LABELS, toRole } from "@/lib/roles";
import { changeRole } from "./actions";

export const metadata = { title: "Admin · GroupFly" };

type Row = { id: string; email: string | null; full_name: string | null; role: string; created_at: string };

export default async function AdminPage() {
  const { supabase, profile } = await requireUser();

  if (!canAccessAdmin(profile.role)) {
    return (
      <div className="card max-w-lg">
        <p className="text-sm font-semibold text-danger">403 · Admins only</p>
        <h1 className="mt-1 text-xl font-bold">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-muted">If you run GroupFly operations, ask an admin to change your role.</p>
        <Link href="/dashboard" className="btn-ghost mt-4">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const [{ data: users }, { count: travellerCount }, { count: poolCount }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, role, created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("travellers").select("id", { count: "exact", head: true }),
    supabase.from("pools").select("id", { count: "exact", head: true }),
  ]);
  const rows = (users ?? []) as Row[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Admin</h1>
        <div className="flex gap-2">
          <Link href="/admin/pools" className="btn-ghost">Operations</Link>
          <Link href="/admin/catalogue" className="btn-ghost">Festivals and routes</Link>
          <Link href="/pools/new" className="btn-brand">Create a pool</Link>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Users", rows.length],
          ["Travellers", travellerCount ?? 0],
          ["Pools", poolCount ?? 0],
        ].map(([label, n]) => (
          <div key={label} className="card">
            <p className="text-sm text-muted">{label}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{n}</p>
          </div>
        ))}
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Users and roles</h2>
        <div className="overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Joined</th>
                <th className="px-4 py-2 font-medium">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2">{u.full_name ?? "—"}</td>
                  <td className="px-4 py-2">{u.email}</td>
                  <td className="px-4 py-2 tabular-nums">{new Date(u.created_at).toLocaleDateString("en-IN")}</td>
                  <td className="px-4 py-2">
                    {u.id === profile.id ? (
                      <span className="chip">{ROLE_LABELS[toRole(u.role)]} (you)</span>
                    ) : (
                      <form action={changeRole} className="flex gap-2">
                        <input type="hidden" name="userId" value={u.id} />
                        <select name="role" defaultValue={toRole(u.role)} className="input py-1" aria-label={`Role for ${u.email}`}>
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="btn-ghost py-1">
                          Save
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
