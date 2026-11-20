import { z } from "zod";

export const TIME_WINDOWS = ["morning", "afternoon", "evening", "night"] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];
export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  morning: "Morning (5–12)",
  afternoon: "Afternoon (12–17)",
  evening: "Evening (17–21)",
  night: "Night (21–5)",
};

export type PoolStatus =
  | "draft"
  | "open"
  | "min_reached"
  | "rfq_sent"
  | "quoted"
  | "payment_due"
  | "names_submitted"
  | "ticketed"
  | "completed"
  | "dissolved";

export const POOL_STATUS_LABELS: Record<PoolStatus, string> = {
  draft: "Draft",
  open: "Open",
  min_reached: "Minimum reached",
  rfq_sent: "Fare requested",
  quoted: "Quote received",
  payment_due: "Payment due",
  names_submitted: "Names sent",
  ticketed: "Ticketed",
  completed: "Completed",
  dissolved: "Closed",
};

export type Pool = {
  id: string;
  festival_id: string | null;
  flight_id: string | null;
  origin: string;
  destination: string;
  travel_date: string;
  time_window: TimeWindow;
  min_seats: number;
  max_seats: number;
  seats_filled: number;
  cut_off_at: string;
  status: PoolStatus;
  market_fare_paise: number | null;
  target_fare_paise: number | null;
  is_private: boolean;
  invite_code: string | null;
  created_by: string | null;
  deposit_paise: number;
};

export type PoolWithRefs = Pool & {
  festival: { name: string } | null;
  flight: { airline: string; flight_no: string; departs_at: string; arrives_at: string } | null;
};

export const POOL_SELECT =
  "id, festival_id, flight_id, origin, destination, travel_date, time_window, min_seats, max_seats, seats_filled, cut_off_at, status, market_fare_paise, target_fare_paise, is_private, invite_code, created_by, deposit_paise, festival:festivals(name), flight:flights(airline, flight_no, departs_at, arrives_at)";

/** Statuses in which people can still join or leave. */
export const JOINABLE_STATUSES: PoolStatus[] = ["open", "min_reached"];

// ---------------------------------------------------------------------------
// Display helpers. All dates and times are shown in India time (IST).
// ---------------------------------------------------------------------------
const TZ = "Asia/Kolkata";

export function formatInr(paise: number | null | undefined): string {
  if (paise == null) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    Math.round(paise / 100),
  );
}

/** "Fri, 29 Oct 2027" for a YYYY-MM-DD travel date (a calendar date, no time zone shift). */
export function formatTravelDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "18:40" in IST for a timestamp. */
export function formatTimeIST(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(
    new Date(iso),
  );
}

/** "8 Oct 2027, 23:59 IST" for a timestamp. */
export function formatDateTimeIST(iso: string): string {
  const s = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(new Date(iso));
  return `${s} IST`;
}

export function poolProgress(seatsFilled: number, minSeats: number, maxSeats: number) {
  const filled = Math.max(0, Math.min(seatsFilled, maxSeats));
  return {
    percent: maxSeats > 0 ? Math.round((filled / maxSeats) * 100) : 0,
    minPercent: maxSeats > 0 ? Math.round((minSeats / maxSeats) * 100) : 0,
    seatsLeft: maxSeats - filled,
    toMinimum: Math.max(0, minSeats - filled),
    minReached: filled >= minSeats,
    isFull: filled >= maxSeats,
  };
}

export function savings(marketPaise: number | null, targetPaise: number | null) {
  if (marketPaise == null || targetPaise == null || marketPaise <= 0 || targetPaise >= marketPaise) return null;
  const amount = marketPaise - targetPaise;
  return { amountPaise: amount, percent: Math.round((amount / marketPaise) * 100) };
}

/** Time left until joining closes, e.g. "21 days left", "5 h 10 min left", "Closed". */
export function cutOffInfo(cutOffIso: string, now: Date = new Date()) {
  const ms = new Date(cutOffIso).getTime() - now.getTime();
  if (ms <= 0) return { closed: true, label: "Joining closed", urgent: false };
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rest = mins % 60;
  let label: string;
  if (days >= 2) label = `${days} days left`;
  else if (days === 1) label = `1 day ${hours} h left`;
  else if (hours >= 1) label = `${hours} h ${rest} min left`;
  else label = `${Math.max(1, rest)} min left`;
  return { closed: false, label, urgent: days < 3 };
}

export function canJoin(pool: Pick<Pool, "status" | "cut_off_at">, now: Date = new Date()): boolean {
  return JOINABLE_STATUSES.includes(pool.status) && new Date(pool.cut_off_at).getTime() > now.getTime();
}

/** What join_pool will do for a party of `partySize`: seats if it all fits, otherwise waitlist. */
export function expectedJoinResult(seatsFilled: number, maxSeats: number, partySize: number): "held" | "waitlisted" {
  return seatsFilled + partySize <= maxSeats ? "held" : "waitlisted";
}

/** Turns database error codes from join_pool / leave_pool / create_pool into plain messages. */
export function poolErrorMessage(raw: string | null | undefined): string {
  const code = (raw ?? "").trim();
  const map: Record<string, string> = {
    NOT_SIGNED_IN: "Log in to continue.",
    SUBSCRIPTION_REQUIRED: "You need an active plan to join pools. See Plans.",
    NO_TRAVELLERS: "Choose at least one traveller.",
    PARTY_TOO_LARGE: "You can add up to 9 travellers at a time.",
    DUPLICATE_TRAVELLER: "Each traveller can be added only once.",
    POOL_NOT_FOUND: "This pool doesn't exist, or you need an invite link to see it.",
    POOL_CLOSED: "This pool is no longer taking new members.",
    POOL_LOCKED: "The fare has been requested, so seats can't be released online. Contact support.",
    CUT_OFF_PASSED: "Joining for this pool has closed.",
    TRAVELLER_NOT_YOURS: "One of those travellers isn't on your account.",
    ALREADY_IN_POOL: "One of those travellers is already in this pool.",
    NOT_A_MEMBER: "You're not in this pool.",
    NOT_ALLOWED: "Only pool organisers and admins can create pools.",
    ORGANISER_PRIVATE_ONLY: "Organisers can create private pools only.",
    SAME_AIRPORT: "Choose different airports for From and To.",
    UNKNOWN_AIRPORT: "Choose airports from the list.",
    DATE_IN_PAST: "The travel date must be in the future.",
    CUT_OFF_IN_PAST: "The joining deadline must be in the future.",
    CUT_OFF_AFTER_TRAVEL: "The joining deadline must be before the travel date.",
    BAD_SEAT_LIMITS: "Seats: minimum at least 10, maximum up to 60, and minimum not above maximum.",
  };
  const key = Object.keys(map).find((k) => code === k || code.includes(k));
  return key ? map[key] : "Something went wrong. Try again.";
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
const iata = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Choose an airport.");

export const searchSchema = z
  .object({
    from: iata,
    to: iata,
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    window: z.enum(TIME_WINDOWS).optional().or(z.literal("").transform(() => undefined)),
    flexible: z
      .union([z.literal("1"), z.literal("on"), z.literal("")])
      .optional()
      .transform((v) => v === "1" || v === "on"),
  })
  .refine((v) => v.from !== v.to, { message: "From and To must be different.", path: ["to"] });

export type PoolSearch = z.infer<typeof searchSchema>;

/** Date range to search: the exact date, or ±1 day when "flexible" is ticked. */
export function searchDateRange(date: string, flexible: boolean): { from: string; to: string } {
  if (!flexible) return { from: date, to: date };
  const [y, m, d] = date.split("-").map(Number);
  const shift = (n: number) => new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  return { from: shift(-1), to: shift(1) };
}

export const createPoolSchema = z
  .object({
    festivalId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
    origin: iata,
    destination: iata,
    travelDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the travel date."),
    timeWindow: z.enum(TIME_WINDOWS, { errorMap: () => ({ message: "Choose a time window." }) }),
    minSeats: z.coerce.number().int().min(10, "At least 10 seats.").max(60),
    maxSeats: z.coerce.number().int().min(10).max(60, "At most 60 seats."),
    cutOffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the joining deadline."),
    marketFare: z.coerce.number().int().min(0).max(500000).optional(),
    targetFare: z.coerce.number().int().min(0).max(500000).optional(),
    isPrivate: z.boolean(),
  })
  .refine((v) => v.origin !== v.destination, { message: "From and To must be different.", path: ["destination"] })
  .refine((v) => v.minSeats <= v.maxSeats, { message: "Minimum can't be above maximum.", path: ["minSeats"] })
  .refine((v) => v.cutOffDate < v.travelDate, { message: "Deadline must be before travel.", path: ["cutOffDate"] });

/** End of the cut-off day in IST (23:59:59 +05:30) as an ISO string. */
export function cutOffEndOfDayIST(date: string): string {
  return `${date}T23:59:59+05:30`;
}
