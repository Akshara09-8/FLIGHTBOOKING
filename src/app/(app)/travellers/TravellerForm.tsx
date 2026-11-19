"use client";

import { useActionState, useEffect, useRef } from "react";
import { GENDERS, GENDER_LABELS } from "@/lib/validation";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";

type Initial = { fullNameAsOnId: string; dateOfBirth: string; gender: string; isSelf: boolean };

export function TravellerForm({
  action,
  initial,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initial?: Initial;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, EMPTY_FORM_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const err = state.errors ?? {};

  // After adding a traveller, clear the form for the next one.
  useEffect(() => {
    if (state.ok && !initial) formRef.current?.reset();
  }, [state, initial]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4" noValidate>
      <div>
        <label htmlFor="fullNameAsOnId" className="label">Full name as on ID</label>
        <input
          id="fullNameAsOnId"
          name="fullNameAsOnId"
          defaultValue={initial?.fullNameAsOnId}
          className="input"
          placeholder="As printed on Aadhaar, passport or licence"
          aria-invalid={Boolean(err.fullNameAsOnId)}
        />
        {err.fullNameAsOnId && <p className="field-error">{err.fullNameAsOnId}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="dateOfBirth" className="label">Date of birth</label>
          <input
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            defaultValue={initial?.dateOfBirth}
            className="input"
            aria-invalid={Boolean(err.dateOfBirth)}
          />
          {err.dateOfBirth && <p className="field-error">{err.dateOfBirth}</p>}
        </div>
        <div>
          <label htmlFor="gender" className="label">Gender</label>
          <select
            id="gender"
            name="gender"
            defaultValue={initial?.gender ?? ""}
            className="input"
            aria-invalid={Boolean(err.gender)}
          >
            <option value="" disabled>
              Choose…
            </option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {GENDER_LABELS[g]}
              </option>
            ))}
          </select>
          {err.gender && <p className="field-error">{err.gender}</p>}
        </div>
      </div>
      <div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isSelf" defaultChecked={initial?.isSelf} className="h-4 w-4 accent-brand" />
          This traveller is me
        </label>
        {err.isSelf && <p className="field-error">{err.isSelf}</p>}
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-brand" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
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
