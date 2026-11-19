import { describe, expect, it } from "vitest";
import { emailSchema, normalisePhone, otpSchema, profileSchema, todayIST, travellerSchema } from "@/lib/validation";

const NOW = new Date("2026-11-16T10:00:00Z");
const traveller = travellerSchema(NOW);

describe("traveller validation (T1.5, T1.6)", () => {
  it("accepts a normal adult", () => {
    const r = traveller.safeParse({ fullNameAsOnId: "Ravi Verma", dateOfBirth: "1990-04-12", gender: "male" });
    expect(r.success).toBe(true);
  });

  it.each(["O'Brien Kelly", "José Álvarez", "Anne-Marie D'Souza", "A. P. J. Kalam", "रवि वर्मा"])(
    "accepts special characters: %s",
    (name) => {
      const r = traveller.safeParse({ fullNameAsOnId: name, dateOfBirth: "1990-01-01", gender: "female" });
      expect(r.success).toBe(true);
    },
  );

  it("collapses repeated spaces and trims", () => {
    const r = traveller.parse({ fullNameAsOnId: "  Asha   Verma ", dateOfBirth: "1990-01-01", gender: "female" });
    expect(r.fullNameAsOnId).toBe("Asha Verma");
  });

  it.each(["A", "", "Asha123", "<script>", "-Asha"])("rejects bad name: %j", (name) => {
    const r = traveller.safeParse({ fullNameAsOnId: name, dateOfBirth: "1990-01-01", gender: "female" });
    expect(r.success).toBe(false);
  });

  it("rejects a future date of birth", () => {
    const r = traveller.safeParse({ fullNameAsOnId: "Asha Verma", dateOfBirth: "2026-11-17", gender: "female" });
    expect(r.success).toBe(false);
  });

  it("accepts a baby born today (IST)", () => {
    const r = traveller.safeParse({ fullNameAsOnId: "Baby Verma", dateOfBirth: "2026-11-16", gender: "other" });
    expect(r.success).toBe(true);
  });

  it.each(["2026-02-30", "1899-12-31", "16-11-1990", ""])("rejects invalid date %j", (dob) => {
    const r = traveller.safeParse({ fullNameAsOnId: "Asha Verma", dateOfBirth: dob, gender: "female" });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown gender value", () => {
    const r = traveller.safeParse({ fullNameAsOnId: "Asha Verma", dateOfBirth: "1990-01-01", gender: "x" });
    expect(r.success).toBe(false);
  });
});

describe("todayIST", () => {
  it("rolls over at midnight IST, not UTC", () => {
    expect(todayIST(new Date("2026-11-16T18:29:00Z"))).toBe("2026-11-16");
    expect(todayIST(new Date("2026-11-16T18:31:00Z"))).toBe("2026-11-17");
  });
});

describe("profile validation", () => {
  it("normalises Indian phone formats", () => {
    expect(normalisePhone("+91 98765-43210")).toBe("+919876543210");
    expect(profileSchema.parse({ fullName: "Asha Verma", phone: "(987) 654 3210" }).phone).toBe("9876543210");
  });

  it("treats an empty phone as not set", () => {
    expect(profileSchema.parse({ fullName: "Asha Verma", phone: "" }).phone).toBeNull();
  });

  it.each(["12345", "98765abc10", "+91 98765 43210 99999"])("rejects bad phone %j", (phone) => {
    expect(profileSchema.safeParse({ fullName: "Asha Verma", phone }).success).toBe(false);
  });
});

describe("sign-in validation (T1.1, T1.2)", () => {
  it("lower-cases and trims the email", () => {
    expect(emailSchema.parse({ email: "  Asha@Example.COM " }).email).toBe("asha@example.com");
  });

  it("rejects an invalid email", () => {
    expect(emailSchema.safeParse({ email: "asha@" }).success).toBe(false);
  });

  it.each(["12345", "1234567", "abcdef", ""])("rejects malformed code %j", (token) => {
    expect(otpSchema.safeParse({ email: "a@b.co", token }).success).toBe(false);
  });

  it("accepts a 6-digit code", () => {
    expect(otpSchema.safeParse({ email: "a@b.co", token: " 012345 " }).success).toBe(true);
  });
});
