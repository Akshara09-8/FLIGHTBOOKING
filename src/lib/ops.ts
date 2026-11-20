import { z } from "zod";
import type { PoolStatus } from "@/lib/pools";

// ---------------------------------------------------------------------------
// Ops dashboard summaries (T4.7)
// ---------------------------------------------------------------------------
export type OpsPool = {
  id: string;
  status: PoolStatus;
  seats_filled: number;
  min_seats: number;
  max_seats: number;
  cut_off_at: string;
  travel_date: string;
};

/** Whole days from now until a timestamp (negative once passed). */
export function daysUntil(iso: string, now: Date = new Date()): number {
  return Math.floor((new Date(iso).getTime() - now.getTime()) / 86_400_000);
}

export function fillRate(p: Pick<OpsPool, "seats_filled" | "max_seats">): number {
  return p.max_seats > 0 ? Math.round((p.seats_filled / p.max_seats) * 100) : 0;
}

export function summarizePools(pools: OpsPool[], now: Date = new Date()) {
  const byStatus: Partial<Record<PoolStatus, number>> = {};
  for (const p of pools) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  const active = pools.filter((p) => p.status !== "dissolved" && p.status !== "completed");
  return {
    total: pools.length,
    byStatus,
    readyForRfq: pools.filter((p) => p.status === "min_reached").length,
    closingSoon: pools.filter(
      (p) => (p.status === "open" || p.status === "min_reached") && daysUntil(p.cut_off_at, now) >= 0 && daysUntil(p.cut_off_at, now) < 7,
    ).length,
    seatsFilled: active.reduce((s, p) => s + p.seats_filled, 0),
    averageFill: active.length ? Math.round(active.reduce((s, p) => s + fillRate(p), 0) / active.length) : 0,
  };
}

/** What an admin should do next for a pool. */
export function nextAction(status: PoolStatus): string {
  const map: Partial<Record<PoolStatus, string>> = {
    open: "Waiting for members",
    min_reached: "Send fare request",
    rfq_sent: "Record the airline's quote",
    quoted: "Accept or reject the quote",
    payment_due: "Collect balances, then submit names",
    names_submitted: "Upload tickets",
    ticketed: "Mark completed after travel",
  };
  return map[status] ?? "—";
}

export const OPS_STATUS_LABELS: Partial<Record<PoolStatus, string>> = {
  min_reached: "Ready for fare request",
};

// ---------------------------------------------------------------------------
// Member-facing timeline
// ---------------------------------------------------------------------------
const STEPS: { key: string; label: string; reachedAt: PoolStatus[] }[] = [
  { key: "joined", label: "Joined pool", reachedAt: ["open", "min_reached", "rfq_sent", "quoted", "payment_due", "names_submitted", "ticketed", "completed"] },
  { key: "filled", label: "Pool filled", reachedAt: ["min_reached", "rfq_sent", "quoted", "payment_due", "names_submitted", "ticketed", "completed"] },
  { key: "requested", label: "Fare requested from airline", reachedAt: ["rfq_sent", "quoted", "payment_due", "names_submitted", "ticketed", "completed"] },
  { key: "quoted", label: "Fare confirmed", reachedAt: ["payment_due", "names_submitted", "ticketed", "completed"] },
  { key: "names", label: "Names sent to airline", reachedAt: ["names_submitted", "ticketed", "completed"] },
  { key: "tickets", label: "E-tickets ready", reachedAt: ["ticketed", "completed"] },
];

export function poolTimeline(status: PoolStatus) {
  const done = STEPS.map((s) => s.reachedAt.includes(status));
  const current = done.lastIndexOf(true);
  return STEPS.map((s, i) => ({ key: s.key, label: s.label, state: done[i] ? (i === current ? "current" : "done") : "todo" }));
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------
/** Balance for a party once the fare is fixed: seats × (fare − deposit), in paise. */
export function balanceDue(seats: number, finalFarePaise: number, depositPaise: number): number {
  if (!Number.isInteger(seats) || seats < 1) throw new Error("Seats must be a positive whole number");
  if (finalFarePaise < depositPaise) throw new Error("Fare can't be below the deposit");
  return seats * (finalFarePaise - depositPaise);
}

// ---------------------------------------------------------------------------
// Passenger manifest (T4.4)
// ---------------------------------------------------------------------------
export type ManifestPassenger = {
  fullNameAsOnId: string;
  dateOfBirth: string; // YYYY-MM-DD
  gender: "female" | "male" | "other" | "undisclosed";
  pnr?: string | null;
  ticketNumber?: string | null;
};

/** Age in whole years on a date. */
export function ageOn(dob: string, onDate: string): number {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [y, m, d] = onDate.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

/** IATA passenger type on the travel date: adult 12+, child 2–11, infant under 2. */
export function paxType(dob: string, travelDate: string): "ADT" | "CHD" | "INF" {
  const age = ageOn(dob, travelDate);
  if (age >= 12) return "ADT";
  if (age >= 2) return "CHD";
  return "INF";
}

/** Airline name fields: everything but the last word is the first name; one-word names repeat (common for Indian IDs). */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

export function titleFor(gender: ManifestPassenger["gender"], type: "ADT" | "CHD" | "INF"): string {
  if (type === "ADT") return gender === "female" ? "MS" : gender === "male" ? "MR" : "MX";
  return gender === "female" ? "MISS" : gender === "male" ? "MSTR" : "MX";
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** 1990-10-29 → 29OCT1990 (airline date style). */
export function airlineDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}${MONTHS.at(m - 1)}${y}`;
}

export const MANIFEST_HEADER = [
  "S.No",
  "Title",
  "First Name",
  "Last Name",
  "Gender",
  "Date of Birth",
  "Pax Type",
  "PNR",
  "Ticket Number",
] as const;

export function manifestRows(passengers: ManifestPassenger[], travelDate: string): string[][] {
  const sorted = [...passengers].sort((a, b) => {
    const sa = splitName(a.fullNameAsOnId);
    const sb = splitName(b.fullNameAsOnId);
    return sa.last.localeCompare(sb.last) || sa.first.localeCompare(sb.first);
  });
  return sorted.map((p, i) => {
    const type = paxType(p.dateOfBirth, travelDate);
    const { first, last } = splitName(p.fullNameAsOnId);
    return [
      String(i + 1),
      titleFor(p.gender, type),
      first.toUpperCase(),
      last.toUpperCase(),
      p.gender === "female" ? "F" : p.gender === "male" ? "M" : "X",
      airlineDate(p.dateOfBirth),
      type,
      p.pnr ?? "",
      p.ticketNumber ?? "",
    ];
  });
}

/** RFC 4180 CSV; cells starting with = + - @ are prefixed with ' so spreadsheets don't run them as formulas. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const cell = (v: string) => {
    let s = v;
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function paxMix(passengers: Pick<ManifestPassenger, "dateOfBirth">[], travelDate: string) {
  const mix = { ADT: 0, CHD: 0, INF: 0 };
  for (const p of passengers) mix[paxType(p.dateOfBirth, travelDate)] += 1;
  return mix;
}

// ---------------------------------------------------------------------------
// Fare request (RFQ) text (T4.2)
// ---------------------------------------------------------------------------
export type RfqInput = {
  airline: string;
  origin: string;
  destination: string;
  travelDate: string;
  timeWindowLabel: string;
  flight?: { airline: string; flight_no: string; departsAtIST: string } | null;
  seats: number;
  mix: { ADT: number; CHD: number; INF: number };
  targetFareRupees: number | null;
  replyBy: string;
  contactEmail: string;
};

export function rfqEmail(r: RfqInput): { subject: string; lines: string[] } {
  const subject = `Group fare request: ${r.seats} seats ${r.origin}-${r.destination} on ${r.travelDate}`;
  const lines = [
    `Dear ${r.airline} group desk,`,
    "",
    `GroupFly requests a group fare for ${r.seats} passengers travelling together:`,
    "",
    `Route: ${r.origin} to ${r.destination}`,
    `Date: ${r.travelDate}`,
    r.flight
      ? `Preferred flight: ${r.flight.airline} ${r.flight.flight_no}, departing ${r.flight.departsAtIST} IST`
      : `Preferred time: ${r.timeWindowLabel}`,
    `Passengers: ${r.mix.ADT} adults, ${r.mix.CHD} children, ${r.mix.INF} infants (one way)`,
    r.targetFareRupees != null ? `Target fare: INR ${r.targetFareRupees.toLocaleString("en-IN")} per seat, all taxes included` : "Target fare: best available group fare",
    "",
    "Please include in your quote: fare per seat, deposit terms, name submission deadline, quote validity and baggage allowance.",
    `We would appreciate a reply by ${r.replyBy}.`,
    "",
    "Regards,",
    "GroupFly operations",
    r.contactEmail,
  ];
  return { subject, lines };
}

// ---------------------------------------------------------------------------
// Admin forms
// ---------------------------------------------------------------------------
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");

export const rfqSchema = z.object({
  airline: z.string().trim().min(2, "Enter the airline.").max(80),
  recipientEmail: z
    .string()
    .trim()
    .email("Enter a valid email or leave it blank.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  message: z.string().trim().max(2000).optional(),
});

export const quoteSchema = z.object({
  airline: z.string().trim().min(2, "Enter the airline.").max(80),
  fareRupees: z.coerce.number().int("Whole rupees only.").min(1, "Enter the fare.").max(500000),
  validUntil: isoDate,
  nameDeadline: isoDate,
  notes: z.string().trim().max(1000).optional(),
});

export const acceptSchema = z.object({ balanceDueDate: isoDate });

export const pnrSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{5,8}$/, "PNR is 5–8 letters or digits.");

/** End of a calendar day in IST as an ISO timestamp. */
export function endOfDayIST(date: string): string {
  return `${date}T23:59:59+05:30`;
}

export function opsErrorMessage(raw: string | null | undefined): string {
  const code = raw ?? "";
  const map: Record<string, string> = {
    NOT_ALLOWED: "Admins only.",
    POOL_NOT_FOUND: "Pool not found.",
    AIRLINE_REQUIRED: "Enter the airline.",
    NOT_READY_FOR_RFQ: "A fare request can be sent once the pool reaches its minimum.",
    BELOW_MINIMUM: "Fewer confirmed (deposit paid) seats than the minimum. Wait for deposits or close the pool.",
    NO_OPEN_RFQ: "Send a fare request before recording a quote.",
    FARE_BELOW_DEPOSIT: "The fare can't be lower than the deposit already paid per seat.",
    QUOTE_EXPIRED: "This quote's validity date has passed.",
    BAD_NAME_DEADLINE: "The name deadline must be in the future and before the travel date.",
    QUOTE_NOT_FOUND: "Quote not found.",
    QUOTE_NOT_PENDING: "This quote was already accepted or rejected.",
    BAD_BALANCE_DEADLINE: "The balance deadline must be in the future and no later than the airline's name deadline.",
    NOT_PAYMENT_DUE: "Names can be submitted only while balances are being collected.",
    BALANCES_OUTSTANDING: "Some balances are unpaid and the deadline hasn't passed. Tick 'Release unpaid seats' to submit anyway.",
    NO_PAID_PASSENGERS: "No passenger has paid the balance.",
    BAD_PNR: "PNR is 5–8 letters or digits.",
    NAMES_NOT_SUBMITTED: "Submit names before adding tickets.",
    NOT_A_PASSENGER: "That traveller isn't a confirmed passenger in this pool.",
    NOT_TICKETED: "Every passenger needs a ticket first.",
    NOT_TRAVELLED_YET: "The pool can be completed after the travel date.",
  };
  const key = Object.keys(map).find((k) => code.includes(k));
  return key ? map[key] : "Something went wrong. Try again.";
}
