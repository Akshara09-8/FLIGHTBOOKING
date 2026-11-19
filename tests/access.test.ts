import { describe, expect, it } from "vitest";
import { canAccessAdmin, canCreatePrivatePool, canJoinPools, isRole, toRole } from "@/lib/roles";
import { isProtectedPath, safeNextPath } from "@/lib/routes";
import { friendlyAuthError } from "@/lib/auth-errors";

describe("roles (T1.3)", () => {
  it("only admins reach the admin area", () => {
    expect(canAccessAdmin("admin")).toBe(true);
    for (const r of ["passenger", "subscriber", "organiser"] as const) expect(canAccessAdmin(r)).toBe(false);
  });

  it("free members can't join pools or create private pools", () => {
    expect(canJoinPools("passenger")).toBe(false);
    expect(canJoinPools("subscriber")).toBe(true);
    expect(canCreatePrivatePool("subscriber")).toBe(false);
    expect(canCreatePrivatePool("organiser")).toBe(true);
  });

  it("falls back to the lowest role for unknown values", () => {
    expect(isRole("superuser")).toBe(false);
    expect(toRole("superuser")).toBe("passenger");
    expect(toRole(undefined)).toBe("passenger");
    expect(toRole("admin")).toBe("admin");
  });
});

describe("protected routes (T1.3, T1.7)", () => {
  it.each(["/dashboard", "/profile", "/travellers", "/travellers/abc", "/admin"])("%s needs sign-in", (p) => {
    expect(isProtectedPath(p)).toBe(true);
  });

  it.each(["/", "/login", "/auth/callback", "/administrator", "/profiles-public"])("%s is public", (p) => {
    expect(isProtectedPath(p)).toBe(false);
  });
});

describe("safeNextPath (open-redirect guard)", () => {
  it("keeps local paths", () => {
    expect(safeNextPath("/travellers?x=1")).toBe("/travellers?x=1");
  });

  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "evil.com", "", null, undefined, "/ok\r\nSet-Cookie:x"])(
    "rejects %j",
    (v) => {
      expect(safeNextPath(v)).toBe("/dashboard");
    },
  );
});

describe("friendlyAuthError (T1.2)", () => {
  it("explains rate limits", () => {
    expect(friendlyAuthError("For security purposes, you can only request this after 60 seconds.")).toMatch(/Wait a minute/);
  });

  it("explains expired or wrong codes", () => {
    expect(friendlyAuthError("Token has expired or is invalid")).toMatch(/wrong or has expired/);
  });

  it("has a safe default", () => {
    expect(friendlyAuthError(undefined)).toMatch(/Try again/);
  });
});
