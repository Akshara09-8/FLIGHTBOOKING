export const ROLES = ["passenger", "subscriber", "organiser", "admin"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Unknown or missing roles are treated as the lowest role. */
export function toRole(value: unknown): Role {
  return isRole(value) ? value : "passenger";
}

export function canAccessAdmin(role: Role): boolean {
  return role === "admin";
}

/** Joining pools needs a paid plan (enforced from Phase 3). */
export function canJoinPools(role: Role): boolean {
  return role === "subscriber" || role === "organiser" || role === "admin";
}

export function canCreatePrivatePool(role: Role): boolean {
  return role === "organiser" || role === "admin";
}

export const ROLE_LABELS: Record<Role, string> = {
  passenger: "Free member",
  subscriber: "Subscriber",
  organiser: "Pool organiser",
  admin: "Admin",
};
