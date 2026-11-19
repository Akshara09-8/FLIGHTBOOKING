"use client";

import { useActionState } from "react";
import { updateProfile } from "./actions";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";

export function ProfileForm({ fullName, phone, email }: { fullName: string; phone: string; email: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateProfile, EMPTY_FORM_STATE);
  const err = state.errors ?? {};

  return (
    <form action={action} className="card max-w-lg space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" value={email} disabled className="input" />
        <p className="mt-1 text-xs text-muted">Your sign-in email can&apos;t be changed here.</p>
      </div>
      <div>
        <label htmlFor="fullName" className="label">Full name</label>
        <input
          id="fullName"
          name="fullName"
          defaultValue={fullName}
          autoComplete="name"
          className="input"
          aria-invalid={Boolean(err.fullName)}
        />
        {err.fullName && <p className="field-error">{err.fullName}</p>}
      </div>
      <div>
        <label htmlFor="phone" className="label">Mobile number</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={phone}
          autoComplete="tel"
          placeholder="+91 98765 43210"
          className="input"
          aria-invalid={Boolean(err.phone)}
        />
        {err.phone && <p className="field-error">{err.phone}</p>}
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-brand" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </button>
        {state.message && (
          <p className={state.ok ? "text-sm text-ok" : "text-sm text-danger"} role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
