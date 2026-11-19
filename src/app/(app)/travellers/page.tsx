import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { GENDER_LABELS } from "@/lib/validation";
import type { Traveller } from "@/lib/types";
import { createTraveller, deleteTraveller } from "./actions";
import { TravellerForm } from "./TravellerForm";

export const metadata = { title: "Travellers · GroupFly" };

function age(dob: string): number {
  const d = new Date(`${dob}T00:00:00`);
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) a -= 1;
  return a;
}

export default async function TravellersPage() {
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("travellers")
    .select("id, full_name_as_on_id, date_of_birth, gender, is_self")
    .eq("user_id", user.id)
    .order("is_self", { ascending: false })
    .order("created_at");
  const travellers = (data ?? []) as Traveller[];

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <section className="min-w-0 space-y-3">
        <div>
          <h1 className="text-2xl font-bold">Travellers</h1>
          <p className="text-sm text-muted">
            People you book for. Names must match their ID exactly, or the airline may deny boarding.
          </p>
        </div>
        {travellers.length === 0 ? (
          <div className="card text-sm text-muted">No travellers yet. Add yourself first using the form.</div>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-white">
            {travellers.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {t.full_name_as_on_id} {t.is_self && <span className="chip ml-1">You</span>}
                  </p>
                  <p className="text-sm text-muted">
                    {GENDER_LABELS[t.gender]} · {age(t.date_of_birth)} yrs · born{" "}
                    {new Date(`${t.date_of_birth}T00:00:00`).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link href={`/travellers/${t.id}`} className="btn-ghost">
                    Edit
                  </Link>
                  <form action={deleteTraveller}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="btn-danger" aria-label={`Remove ${t.full_name_as_on_id}`}>
                      Remove
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <aside className="card h-fit">
        <h2 className="mb-4 font-semibold">Add a traveller</h2>
        <TravellerForm action={createTraveller} submitLabel="Add traveller" />
      </aside>
    </div>
  );
}
