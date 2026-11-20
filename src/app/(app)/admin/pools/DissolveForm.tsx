"use client";

import { useActionState, useState } from "react";
import { dissolvePool } from "./actions";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";

export function DissolveForm({ poolId, label }: { poolId: string; label: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(dissolvePool, EMPTY_FORM_STATE);
  const [confirming, setConfirming] = useState(false);

  if (state.message) {
    return <p className={state.ok ? "text-sm text-ok" : "text-sm text-danger"}>{state.message}</p>;
  }
  if (!confirming) {
    return (
      <button type="button" className="text-sm text-danger hover:underline" onClick={() => setConfirming(true)}>
        Close pool
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="poolId" value={poolId} />
      <span className="text-sm">Close {label} and refund every deposit? This can&apos;t be undone.</span>
      <button type="submit" className="btn-danger py-1" disabled={pending}>
        {pending ? "Closing…" : "Yes, close"}
      </button>
      <button type="button" className="btn-ghost py-1" onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </form>
  );
}
