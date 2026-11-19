import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/roles";
import { addAirport, addFestival, deleteFestival, toggleAirport } from "./actions";

export const metadata = { title: "Catalogue · Admin · GroupFly" };

type Festival = { id: string; name: string; start_date: string; end_date: string; region: string | null };
type Airport = { code: string; city: string; name: string; active: boolean };

export default async function CataloguePage() {
  const { supabase, profile } = await requireUser();
  if (!canAccessAdmin(profile.role)) {
    return (
      <div className="card max-w-lg">
        <p className="text-sm font-semibold text-danger">403 · Admins only</p>
        <Link href="/dashboard" className="btn-ghost mt-4">Back to dashboard</Link>
      </div>
    );
  }

  const [{ data: festivals }, { data: airports }] = await Promise.all([
    supabase.from("festivals").select("id, name, start_date, end_date, region").order("start_date"),
    supabase.from("airports").select("code, city, name, active").order("city"),
  ]);

  return (
    <div className="space-y-10">
      <div>
        <Link href="/admin" className="text-sm text-brand hover:underline">← Admin</Link>
        <h1 className="mt-1 text-2xl font-bold">Festivals and routes</h1>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Festival calendar</h2>
        <form action={addFestival} className="card grid gap-3 sm:grid-cols-5">
          <input name="name" required placeholder="Holi 2028" className="input sm:col-span-2" aria-label="Festival name" />
          <input name="startDate" type="date" required className="input" aria-label="Start date" />
          <input name="endDate" type="date" required className="input" aria-label="End date" />
          <input name="region" placeholder="Region (optional)" className="input" aria-label="Region" />
          <button type="submit" className="btn-brand sm:col-span-5 sm:justify-self-start">Add festival</button>
        </form>
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {((festivals ?? []) as Festival[]).map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
              <span>
                <b>{f.name}</b> · {f.start_date} to {f.end_date}
                {f.region && <span className="text-muted"> · {f.region}</span>}
              </span>
              <form action={deleteFestival}>
                <input type="hidden" name="id" value={f.id} />
                <button type="submit" className="text-danger hover:underline">Delete</button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Airports</h2>
        <form action={addAirport} className="card grid gap-3 sm:grid-cols-4">
          <input name="code" required maxLength={3} placeholder="IXC" className="input uppercase" aria-label="IATA code" />
          <input name="city" required placeholder="Chandigarh" className="input" aria-label="City" />
          <input name="name" required placeholder="Airport name" className="input" aria-label="Airport name" />
          <button type="submit" className="btn-brand">Add or update</button>
        </form>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {((airports ?? []) as Airport[]).map((a) => (
            <li key={a.code} className="card flex items-center justify-between gap-2 py-3 text-sm">
              <span className={a.active ? "" : "text-muted line-through"}>
                <b>{a.code}</b> · {a.city}
              </span>
              <form action={toggleAirport}>
                <input type="hidden" name="code" value={a.code} />
                <input type="hidden" name="active" value={String(a.active)} />
                <button type="submit" className="text-brand hover:underline">{a.active ? "Hide" : "Show"}</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
