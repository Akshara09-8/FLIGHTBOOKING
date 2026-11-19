"use client";

import Link from "next/link";
import { useActionState } from "react";
import { joinPool } from "../actions";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";

type Option = { id: string; name: string };

export function JoinForm({
  poolId,
  code,
  travellers,
  seatsLeft,
}: {
  poolId: string;
  code?: string;
  travellers: Option[];
  seatsLeft: number;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(joinPool, EMPTY_FORM_STATE);

  if (state.ok) {
    return (
      <p className="rounded-lg bg-brand-soft px-4 py-3 text-sm text-brand" role="status">
        {state.message}
      </p>
    );
  }

  if (travellers.length === 0) {
    return (
      <p className="text-sm text-muted">
        All your saved travellers are already in this pool.{" "}
        <Link href="/travellers" className="text-brand underline">Add another traveller</Link>
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="poolId" value={poolId} />
      {code && <input type="hidden" name="code" value={code} />}
      <fieldset className="space-y-2">
        <legend className="label">Who&apos;s travelling?</legend>
        {travellers.map((t) => (
          <label key={t.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="travellerIds" value={t.id} className="h-4 w-4 accent-brand" />
            {t.name}
          </label>
        ))}
      </fieldset>
      {state.errors?.travellerIds && <p className="field-error">{state.errors.travellerIds}</p>}
      <p className="text-xs text-muted">
        {seatsLeft > 0
          ? `${seatsLeft} seat${seatsLeft > 1 ? "s" : ""} left. If your whole group doesn't fit, it goes on the waitlist together.`
          : "The pool is full. Joining puts your group on the waitlist."}
      </p>
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Joining…" : seatsLeft > 0 ? "Join pool" : "Join waitlist"}
      </button>
      {state.message && <p className="field-error" role="alert">{state.message}</p>}
      <p className="text-xs text-muted">
        No payment yet. Deposits arrive in the next release; joining holds your place.
      </p>
    </form>
  );
}
