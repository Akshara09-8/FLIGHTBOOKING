import { describe, expect, it } from "vitest";
import {
  canJoin,
  createPoolSchema,
  cutOffEndOfDayIST,
  cutOffInfo,
  expectedJoinResult,
  formatDateTimeIST,
  formatInr,
  formatTimeIST,
  formatTravelDate,
  poolErrorMessage,
  poolProgress,
  savings,
  searchDateRange,
  searchSchema,
} from "@/lib/pools";

describe("search validation (T2.1, T2.7)", () => {
  it("normalises airport codes and keeps optional fields", () => {
    const r = searchSchema.parse({ from: "del", to: " pat ", date: "2027-10-29", window: "evening", flexible: "1" });
    expect(r).toEqual({ from: "DEL", to: "PAT", date: "2027-10-29", window: "evening", flexible: true });
  });

  it("treats empty optional fields as not set", () => {
    const r = searchSchema.parse({ from: "DEL", to: "PAT", date: "", window: "", flexible: "" });
    expect(r.date).toBeUndefined();
    expect(r.window).toBeUndefined();
    expect(r.flexible).toBe(false);
  });

  it.each([
    { from: "DEL", to: "DEL" },
    { from: "DELHI", to: "PAT" },
    { from: "", to: "PAT" },
    { from: "DEL", to: "PAT", window: "noon" },
  ])("rejects %j", (input) => {
    expect(searchSchema.safeParse(input).success).toBe(false);
  });

  it("widens to ±1 day when flexible, across month ends", () => {
    expect(searchDateRange("2027-10-29", false)).toEqual({ from: "2027-10-29", to: "2027-10-29" });
    expect(searchDateRange("2027-11-01", true)).toEqual({ from: "2027-10-31", to: "2027-11-02" });
  });
});

describe("joining rules (T2.2, T2.3, T2.4)", () => {
  it("seats the whole party only if it fits", () => {
    expect(expectedJoinResult(32, 40, 4)).toBe("held");
    expect(expectedJoinResult(36, 40, 4)).toBe("held");
    expect(expectedJoinResult(37, 40, 4)).toBe("waitlisted");
    expect(expectedJoinResult(40, 40, 1)).toBe("waitlisted");
  });

  it("blocks joining after the cut-off or once the fare is requested", () => {
    const now = new Date("2027-10-01T00:00:00Z");
    expect(canJoin({ status: "open", cut_off_at: "2027-10-08T18:29:59Z" }, now)).toBe(true);
    expect(canJoin({ status: "min_reached", cut_off_at: "2027-10-08T18:29:59Z" }, now)).toBe(true);
    expect(canJoin({ status: "open", cut_off_at: "2027-09-30T23:59:59Z" }, now)).toBe(false);
    expect(canJoin({ status: "rfq_sent", cut_off_at: "2027-10-08T18:29:59Z" }, now)).toBe(false);
  });
});

describe("progress and fares", () => {
  it("reports seats left and minimum", () => {
    expect(poolProgress(32, 30, 40)).toEqual({
      percent: 80,
      minPercent: 75,
      seatsLeft: 8,
      toMinimum: 0,
      minReached: true,
      isFull: false,
    });
    expect(poolProgress(18, 30, 40).toMinimum).toBe(12);
    expect(poolProgress(40, 30, 40).isFull).toBe(true);
  });

  it("computes savings only when the group fare is lower", () => {
    expect(savings(1480000, 945000)).toEqual({ amountPaise: 535000, percent: 36 });
    expect(savings(900000, 950000)).toBeNull();
    expect(savings(null, 950000)).toBeNull();
  });

  it("formats rupees in Indian grouping", () => {
    expect(formatInr(1480000)).toBe("₹14,800");
    expect(formatInr(12345678900)).toBe("₹12,34,56,789");
    expect(formatInr(null)).toBe("—");
  });
});

describe("dates and times in IST (T2.8)", () => {
  it("shows a travel date without shifting the day", () => {
    expect(formatTravelDate("2027-10-29")).toMatch(/Fri.*29.*Oct.*2027/);
  });

  it("shows flight times in IST regardless of the server's zone", () => {
    expect(formatTimeIST("2027-10-29T13:10:00Z")).toBe("18:40");
    expect(formatDateTimeIST("2027-10-08T18:29:00Z")).toMatch(/8 Oct 2027.*23:59 IST/);
  });

  it("puts the cut-off at the end of the day in IST", () => {
    expect(new Date(cutOffEndOfDayIST("2027-10-08")).toISOString()).toBe("2027-10-08T18:29:59.000Z");
  });

  it("describes time left until the cut-off", () => {
    const now = new Date("2027-10-01T00:00:00Z");
    expect(cutOffInfo("2027-10-22T00:00:00Z", now)).toMatchObject({ closed: false, label: "21 days left", urgent: false });
    expect(cutOffInfo("2027-10-02T05:00:00Z", now).label).toBe("1 day 5 h left");
    expect(cutOffInfo("2027-10-01T05:10:00Z", now)).toMatchObject({ label: "5 h 10 min left", urgent: true });
    expect(cutOffInfo("2027-09-30T00:00:00Z", now)).toMatchObject({ closed: true });
  });
});

describe("pool error messages", () => {
  it("maps database codes inside longer messages", () => {
    expect(poolErrorMessage("CUT_OFF_PASSED")).toMatch(/closed/);
    expect(poolErrorMessage('ERROR: P0001: ALREADY_IN_POOL')).toMatch(/already in this pool/);
    expect(poolErrorMessage("weird")).toMatch(/Try again/);
  });
});

describe("create pool validation", () => {
  const base = {
    origin: "DEL",
    destination: "PAT",
    travelDate: "2027-10-29",
    timeWindow: "evening",
    minSeats: "30",
    maxSeats: "40",
    cutOffDate: "2027-10-08",
    isPrivate: true,
  };

  it("accepts a valid pool", () => {
    const r = createPoolSchema.parse({ ...base, festivalId: "" });
    expect(r.minSeats).toBe(30);
    expect(r.festivalId).toBeUndefined();
  });

  it.each([
    { minSeats: "5" },
    { maxSeats: "80" },
    { minSeats: "45" },
    { destination: "DEL" },
    { cutOffDate: "2027-10-29" },
  ])("rejects %j", (patch) => {
    expect(createPoolSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
});
