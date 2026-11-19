/** Pages that need a signed-in user. */
export const PROTECTED_PREFIXES = ["/dashboard", "/profile", "/travellers", "/admin", "/pools/new"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Only allow redirects to paths on this site ("/dashboard"), never to another
 * host ("//evil.com", "https://evil.com", "/\evil.com").
 */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(next)) return fallback;
  return next;
}
