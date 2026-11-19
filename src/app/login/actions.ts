"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, fieldErrors, otpSchema } from "@/lib/validation";
import { friendlyAuthError } from "@/lib/auth-errors";
import { safeNextPath } from "@/lib/routes";

export type LoginState = {
  step: "email" | "code";
  email: string;
  error?: string;
  message?: string;
};

/** One action for both steps: intent = "send" (email a code) or "verify" (check the code). */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const intent = String(formData.get("intent") ?? "send");
  const rawEmail = String(formData.get("email") ?? "");
  const supabase = await createClient();

  if (intent === "change-email") return { step: "email", email: rawEmail };

  if (intent === "send") {
    const parsed = emailSchema.safeParse({ email: rawEmail });
    if (!parsed.success) return { step: "email", email: rawEmail, error: fieldErrors(parsed.error).email };

    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: { shouldCreateUser: true },
    });
    if (error) return { step: "email", email: parsed.data.email, error: friendlyAuthError(error.message) };
    return { step: "code", email: parsed.data.email, message: `We sent a 6-digit code to ${parsed.data.email}.` };
  }

  const parsed = otpSchema.safeParse({ email: rawEmail, token: formData.get("token") ?? "" });
  if (!parsed.success) {
    const errs = fieldErrors(parsed.error);
    return { step: "code", email: rawEmail, error: errs.token ?? errs.email };
  }
  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.token,
    type: "email",
  });
  if (error) return { step: "code", email: parsed.data.email, error: friendlyAuthError(error.message) };

  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signInWithGoogle(formData: FormData) {
  const next = safeNextPath(String(formData.get("next") ?? ""));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
