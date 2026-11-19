"use client";

import { useActionState } from "react";
import { createPool } from "../actions";
import { TIME_WINDOWS, TIME_WINDOW_LABELS } from "@/lib/pools";
import { EMPTY_FORM_STATE, type FormState } from "@/lib/form-state";

type Option = { value: string; label: string };

export function CreatePoolForm({
  airports,
  festivals,
  isAdmin,
}: {
  airports: Option[];
  festivals: Option[];
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createPool, EMPTY_FORM_STATE);
  const err = state.errors ?? {};
  const Err = ({ name }: { name: string }) => (err[name] ? <p className="field-error">{err[name]}</p> : null);

  return (
    <form action={action} className="card grid gap-4 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <label htmlFor="festivalId" className="label">Festival (optional)</label>
        <select id="festivalId" name="festivalId" defaultValue="" className="input">
          <option value="">None</option>
          {festivals.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>
      {(["origin", "destination"] as const).map((field) => (
        <div key={field}>
          <label htmlFor={field} className="label">{field === "origin" ? "From" : "To"}</label>
          <select id={field} name={field} defaultValue="" className="input" aria-invalid={Boolean(err[field])}>
            <option value="" disabled>Choose city</option>
            {airports.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          <Err name={field} />
        </div>
      ))}
      <div>
        <label htmlFor="travelDate" className="label">Travel date</label>
        <input id="travelDate" name="travelDate" type="date" className="input" />
        <Err name="travelDate" />
      </div>
      <div>
        <label htmlFor="timeWindow" className="label">Time window</label>
        <select id="timeWindow" name="timeWindow" defaultValue="" className="input">
          <option value="" disabled>Choose</option>
          {TIME_WINDOWS.map((w) => (
            <option key={w} value={w}>{TIME_WINDOW_LABELS[w]}</option>
          ))}
        </select>
        <Err name="timeWindow" />
      </div>
      <div>
        <label htmlFor="minSeats" className="label">Minimum seats</label>
        <input id="minSeats" name="minSeats" type="number" min={10} max={60} defaultValue={30} className="input" />
        <Err name="minSeats" />
      </div>
      <div>
        <label htmlFor="maxSeats" className="label">Maximum seats</label>
        <input id="maxSeats" name="maxSeats" type="number" min={10} max={60} defaultValue={40} className="input" />
        <Err name="maxSeats" />
      </div>
      <div>
        <label htmlFor="cutOffDate" className="label">Joining closes on</label>
        <input id="cutOffDate" name="cutOffDate" type="date" className="input" />
        <p className="mt-1 text-xs text-muted">At 23:59 IST. Suggested: 21 days before travel.</p>
        <Err name="cutOffDate" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="marketFare" className="label">Typical fare (₹)</label>
          <input id="marketFare" name="marketFare" type="number" min={0} className="input" placeholder="14800" />
        </div>
        <div>
          <label htmlFor="targetFare" className="label">Target fare (₹)</label>
          <input id="targetFare" name="targetFare" type="number" min={0} className="input" placeholder="9450" />
        </div>
      </div>
      <div className="sm:col-span-2">
        {isAdmin ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isPrivate" className="h-4 w-4 accent-brand" />
            Private pool (only people with the invite link can see it)
          </label>
        ) : (
          <>
            <input type="hidden" name="isPrivate" value="on" />
            <p className="text-sm text-muted">This will be a private pool. You&apos;ll get an invite link to share.</p>
          </>
        )}
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Creating…" : "Create pool"}
        </button>
        {state.message && <p className="field-error" role="alert">{state.message}</p>}
      </div>
    </form>
  );
}
