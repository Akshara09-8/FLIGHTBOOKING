import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { updateTraveller } from "../actions";
import { TravellerForm } from "../TravellerForm";
import type { Traveller } from "@/lib/types";

export const metadata = { title: "Edit traveller · GroupFly" };

export default async function EditTravellerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("travellers")
    .select("id, full_name_as_on_id, date_of_birth, gender, is_self")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) notFound();
  const t = data as Traveller;

  return (
    <div className="max-w-lg space-y-4">
      <Link href="/travellers" className="text-sm text-brand hover:underline">
        ← All travellers
      </Link>
      <h1 className="text-2xl font-bold">Edit {t.full_name_as_on_id}</h1>
      <div className="card">
        <TravellerForm
          action={updateTraveller.bind(null, t.id)}
          submitLabel="Save changes"
          initial={{
            fullNameAsOnId: t.full_name_as_on_id,
            dateOfBirth: t.date_of_birth,
            gender: t.gender,
            isSelf: t.is_self,
          }}
        />
      </div>
    </div>
  );
}
