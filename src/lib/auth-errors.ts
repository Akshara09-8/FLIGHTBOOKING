/** Turns Supabase auth errors into messages a traveller can act on. */
export function friendlyAuthError(message: string | undefined | null): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("rate limit") || m.includes("security purposes") || m.includes("too many")) {
    return "Too many attempts. Wait a minute, then request a new code.";
  }
  if (m.includes("expired") || m.includes("invalid") || m.includes("token")) {
    return "That code is wrong or has expired. Check the latest email or request a new code.";
  }
  if (m.includes("signups not allowed")) {
    return "New sign-ups are closed right now.";
  }
  return "Something went wrong signing you in. Try again.";
}
