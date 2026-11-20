"use client";

import { useActionState, useState } from "react";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";

/**
 * A form for an admin step: shows field errors and the result message.
 * With `confirm`, the first click asks for confirmation.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  confirm,
  danger,
  className = "space-y-3",
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  children?: React.ReactNode;
  confirm?: string;
  danger?: boolean;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, EMPTY_FORM_STATE);
  const [asking, setAsking] = useState(false);
  const errors = state.errors ? Object.values(state.errors) : [];

  return (
    <form action={formAction} className={className} onSubmit={() => setAsking(false)}>
      {children}
      {errors.length > 0 && (
        <ul className="field-error space-y-0.5" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {confirm && !asking ? (
        <button type="button" className={danger ? "btn-danger" : "btn-brand"} onClick={() => setAsking(true)}>
          {submitLabel}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {confirm && <span className="text-sm">{confirm}</span>}
          <button type="submit" className={danger ? "btn-danger" : "btn-brand"} disabled={pending}>
            {pending ? "Working…" : confirm ? "Yes, continue" : submitLabel}
          </button>
          {confirm && (
            <button type="button" className="btn-ghost" onClick={() => setAsking(false)}>
              Cancel
            </button>
          )}
        </div>
      )}
      {state.message && (
        <p className={state.ok ? "text-sm text-ok" : "text-sm text-danger"} role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
