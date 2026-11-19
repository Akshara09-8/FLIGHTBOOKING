import { z } from "zod";

// Letters from any language, plus spaces, apostrophes, dots and hyphens (O'Brien, José, Anne-Marie).
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}' .-]*$/u;

const personName = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(2, "Enter at least 2 characters.")
      .max(100, "Keep the name under 100 characters.")
      .regex(NAME_PATTERN, "Use letters, spaces, apostrophes, dots or hyphens only."),
  );

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");

export const emailSchema = z.object({ email });

export const otpSchema = z.object({
  email,
  token: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from the email."),
});

/** Strips spaces, dashes and brackets; keeps an optional leading +. */
export function normalisePhone(raw: string): string {
  return raw.replace(/[\s\-()]/g, "");
}

export const profileSchema = z.object({
  fullName: personName,
  phone: z
    .string()
    .trim()
    .transform(normalisePhone)
    .refine((v) => v === "" || /^\+?\d{10,15}$/.test(v), "Enter a 10-15 digit phone number, e.g. +919876543210.")
    .transform((v) => (v === "" ? null : v)),
});

export const GENDERS = ["female", "male", "other", "undisclosed"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = {
  female: "Female",
  male: "Male",
  other: "Other",
  undisclosed: "Prefer not to say",
};

function isRealDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** Today's date in India (IST, UTC+5:30), as YYYY-MM-DD. */
export function todayIST(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function travellerSchema(now: Date = new Date()) {
  const today = todayIST(now);
  return z.object({
    fullNameAsOnId: personName,
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of birth.")
      .refine(isRealDate, "Enter a real date.")
      .refine((v) => v <= today, "Date of birth can't be in the future.")
      .refine((v) => v >= "1900-01-01", "Check the year of birth."),
    gender: z.enum(GENDERS, { errorMap: () => ({ message: "Choose an option." }) }),
    isSelf: z.boolean().default(false),
  });
}

export type TravellerInput = z.infer<ReturnType<typeof travellerSchema>>;
export type ProfileInput = z.infer<typeof profileSchema>;

/** Flattens zod errors to { field: "first message" } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
