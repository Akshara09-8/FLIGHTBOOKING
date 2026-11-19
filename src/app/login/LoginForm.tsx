"use client";

import { useActionState } from "react";
import { loginAction, signInWithGoogle, type LoginState } from "./actions";

export function LoginForm({ next, oauthError }: { next: string; oauthError: boolean }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {
    step: "email",
    email: "",
    error: oauthError ? "Google sign-in didn't finish. Try again or use an email code." : undefined,
  });

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-3" noValidate>
        <input type="hidden" name="next" value={next} />
        {state.step === "email" ? (
          <>
            <label htmlFor="email" className="label">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={state.email}
              className="input"
              placeholder="you@example.com"
              aria-invalid={Boolean(state.error)}
              aria-describedby={state.error ? "login-error" : undefined}
            />
            <button type="submit" name="intent" value="send" className="btn-primary w-full" disabled={pending}>
              {pending ? "Sending code…" : "Email me a sign-in code"}
            </button>
          </>
        ) : (
          <>
            <input type="hidden" name="email" value={state.email} />
            {state.message && <p className="text-sm text-ok" role="status">{state.message}</p>}
            <label htmlFor="token" className="label">6-digit code</label>
            <input
              id="token"
              name="token"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              className="input tracking-[0.4em]"
              aria-invalid={Boolean(state.error)}
              aria-describedby={state.error ? "login-error" : undefined}
            />
            <button type="submit" name="intent" value="verify" className="btn-primary w-full" disabled={pending}>
              {pending ? "Checking…" : "Log in"}
            </button>
            <div className="flex justify-between text-sm">
              <button type="submit" name="intent" value="send" className="text-brand hover:underline" disabled={pending}>
                Send a new code
              </button>
              <button type="submit" name="intent" value="change-email" className="text-muted hover:underline">
                Use a different email
              </button>
            </div>
          </>
        )}
        {state.error && (
          <p id="login-error" className="field-error" role="alert">
            {state.error}
          </p>
        )}
      </form>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>

      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <button type="submit" className="btn-ghost w-full">Continue with Google</button>
      </form>
    </div>
  );
}
