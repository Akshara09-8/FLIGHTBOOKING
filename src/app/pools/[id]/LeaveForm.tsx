"use client";

import { useActionState, useState } from "react";
import { leavePool } from "../actions";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";

export function LeaveForm({ poolId, seatCount }: { poolId: string; seatCount: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(leavePool, EMPTY_FORM_STATE);
  const [confirming, setConfirming] = useState(false);

  if (state.ok) return <p className="text-sm text-ok" role="status">{state.message}</p>;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="poolId" value={poolId} />
      {confirming ? (
        <div className="space-y-2 rounded-lg border border-danger/30 p-3">
          <p className="text-sm">
            Release {seatCount === 1 ? "your seat" : `all ${seatCount} of your group's places`}? Someone on the waitlist
            may take them.
          </p>
          <div className="flex gap-2">
            <button type="submit" className="btn-danger" disabled={pending}>
              {pending ? "Leaving…" : "Yes, leave pool"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>
              Stay
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-ghost w-full" onClick={() => setConfirming(true)}>
          Leave pool
        </button>
      )}
      {state.message && <p className="field-error" role="alert">{state.message}</p>}
    </form>
  );
}
