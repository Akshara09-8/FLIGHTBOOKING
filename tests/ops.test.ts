import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  acceptSchema,
  ageOn,
  airlineDate,
  balanceDue,
  daysUntil,
  endOfDayIST,
  fillRate,
  manifestRows,
  MANIFEST_HEADER,
  nextAction,
  opsErrorMessage,
  paxMix,
  paxType,
  pnrSchema,
  poolTimeline,
  quoteSchema,
  rfqEmail,
  rfqSchema,
  splitName,
  summarizePools,
  titleFor,
  toCsv,
  type OpsPool,
  type RfqInput,
} from "@/lib/ops";
import { buildRfqPdf } from "@/lib/ops-pdf";

describe("ops dashboard numbers (T4.7)", () => {
  const now = new Date("2027-10-01T00:00:00Z");
  const pool = (over: Partial<OpsPool>): OpsPool => ({
    id: Math.random().toString(),
    status: "open",
    seats_filled: 20,
    min_seats: 30,
    max_seats: 40,
    cut_off_at: "2027-10-20T18:29:59Z",
    travel_date: "2027-10-29",
    ...over,
  });

  it("counts pools by status and flags what needs action", () => {
    const s = summarizePools(
      [
        pool({ status: "open", cut_off_at: "2027-10-04T00:00:00Z" }),
        pool({ status: "min_reached", seats_filled: 32 }),
        pool({ status: "min_reached", seats_filled: 36, cut_off_at: "2027-10-05T00:00:00Z" }),
        pool({ status: "payment_due", seats_filled: 35 }),
        pool({ status: "dissolved", seats_filled: 0 }),
      ],
      now,
    );
    expect(s.total).toBe(5);
    expect(s.byStatus).toEqual({ open: 1, min_reached: 2, payment_due: 1, dissolved: 1 });
    expect(s.readyForRfq).toBe(2);
    expect(s.closingSoon).toBe(2);
    expect(s.seatsFilled).toBe(20 + 32 + 36 + 35);
    expect(s.averageFill).toBe(Math.round((50 + 80 + 90 + 88) / 4));
  });

  it("computes fill rate and days to cut-off", () => {
    expect(fillRate({ seats_filled: 32, max_seats: 40 })).toBe(80);
    expect(daysUntil("2027-10-22T00:00:00Z", now)).toBe(21);
    expect(daysUntil("2027-09-30T00:00:00Z", now)).toBe(-1);
  });

  it("names the next step for each stage", () => {
    expect(nextAction("min_reached")).toBe("Send fare request");
    expect(nextAction("quoted")).toBe("Accept or reject the quote");
    expect(nextAction("dissolved")).toBe("—");
  });
});

describe("member timeline", () => {
  it("marks steps done up to the current stage", () => {
    const t = poolTimeline("payment_due");
    expect(t.map((s) => s.state)).toEqual(["done", "done", "done", "current", "todo", "todo"]);
    expect(poolTimeline("open")[0].state).toBe("current");
    expect(poolTimeline("ticketed").at(-1)?.state).toBe("current");
  });
});

describe("balances (T4.3)", () => {
  it("charges fare minus deposit per seat", () => {
    expect(balanceDue(3, 945000, 150000)).toBe(3 * 795000);
    expect(balanceDue(1, 150000, 150000)).toBe(0);
    expect(() => balanceDue(2, 100000, 150000)).toThrow();
    expect(() => balanceDue(0, 945000, 150000)).toThrow();
  });
});

describe("manifest (T4.4)", () => {
  const travel = "2027-10-29";

  it("works out passenger type from age on the travel date", () => {
    expect(ageOn("2015-10-30", travel)).toBe(11);
    expect(paxType("1990-04-12", travel)).toBe("ADT");
    expect(paxType("2015-10-29", travel)).toBe("ADT"); // 12th birthday on the travel date
    expect(paxType("2015-10-30", travel)).toBe("CHD");
    expect(paxType("2025-10-30", travel)).toBe("INF");
    expect(paxType("2025-10-29", travel)).toBe("CHD");
  });

  it("splits names and picks titles", () => {
    expect(splitName("Anne-Marie D'Souza")).toEqual({ first: "Anne-Marie", last: "D'Souza" });
    expect(splitName("A. P. J. Kalam")).toEqual({ first: "A. P. J.", last: "Kalam" });
    expect(splitName("Madhu")).toEqual({ first: "Madhu", last: "Madhu" });
    expect(titleFor("female", "ADT")).toBe("MS");
    expect(titleFor("male", "CHD")).toBe("MSTR");
    expect(titleFor("other", "ADT")).toBe("MX");
  });

  it("formats dates the airline way", () => {
    expect(airlineDate("1990-10-09")).toBe("09OCT1990");
  });

  it("builds one row per passenger, sorted by last name, names upper-cased exactly", () => {
    const rows = manifestRows(
      [
        { fullNameAsOnId: "Ravi Verma", dateOfBirth: "1988-01-15", gender: "male", pnr: "AB12CD" },
        { fullNameAsOnId: "Asha Kapoor", dateOfBirth: "1990-04-12", gender: "female" },
        { fullNameAsOnId: "Baby Verma", dateOfBirth: "2026-05-01", gender: "other" },
      ],
      travel,
    );
    expect(rows).toEqual([
      ["1", "MS", "ASHA", "KAPOOR", "F", "12APR1990", "ADT", "", ""],
      ["2", "MX", "BABY", "VERMA", "X", "01MAY2026", "INF", "", ""],
      ["3", "MR", "RAVI", "VERMA", "M", "15JAN1988", "ADT", "AB12CD", ""],
    ]);
    expect(MANIFEST_HEADER).toHaveLength(rows[0].length);
  });

  it("writes safe CSV", () => {
    expect(toCsv([["a", "b,c", 'say "hi"'], ["=SUM(A1)", "-1", "x\ny"]])).toBe(
      'a,"b,c","say ""hi"""\r\n\'=SUM(A1),\'-1,"x\ny"\r\n',
    );
  });

  it("counts the passenger mix", () => {
    expect(paxMix([{ dateOfBirth: "1990-01-01" }, { dateOfBirth: "2018-01-01" }, { dateOfBirth: "2026-01-01" }], travel)).toEqual({
      ADT: 1,
      CHD: 1,
      INF: 1,
    });
  });
});

describe("fare request (T4.2)", () => {
  const input: RfqInput = {
    airline: "Demo Air",
    origin: "DEL",
    destination: "PAT",
    travelDate: "2027-10-29",
    timeWindowLabel: "Evening (17–21)",
    flight: { airline: "Demo Air", flight_no: "DA 401", departsAtIST: "18:40" },
    seats: 32,
    mix: { ADT: 30, CHD: 2, INF: 0 },
    targetFareRupees: 9450,
    replyBy: "12 Oct 2027",
    contactEmail: "ops@groupfly.example",
  };

  it("states route, date, seats and target fare", () => {
    const { subject, lines } = rfqEmail(input);
    expect(subject).toBe("Group fare request: 32 seats DEL-PAT on 2027-10-29");
    const text = lines.join("\n");
    expect(text).toContain("Route: DEL to PAT");
    expect(text).toContain("Date: 2027-10-29");
    expect(text).toContain("Preferred flight: Demo Air DA 401, departing 18:40 IST");
    expect(text).toContain("Passengers: 30 adults, 2 children, 0 infants");
    expect(text).toContain("Target fare: INR 9,450 per seat");
  });

  it("falls back to the time window and best fare", () => {
    const text = rfqEmail({ ...input, flight: null, targetFareRupees: null }).lines.join("\n");
    expect(text).toContain("Preferred time: Evening (17–21)");
    expect(text).toContain("best available group fare");
  });

  it("makes a one-page PDF", async () => {
    const doc = await PDFDocument.load(await buildRfqPdf(input, "1 Oct 2027"));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toContain("32 seats DEL-PAT");
  });
});

describe("admin forms", () => {
  it("validates fare requests and quotes", () => {
    expect(rfqSchema.parse({ airline: " Demo Air ", recipientEmail: "" })).toEqual({ airline: "Demo Air" });
    expect(rfqSchema.safeParse({ airline: "D" }).success).toBe(false);
    expect(quoteSchema.parse({ airline: "Demo Air", fareRupees: "9450", validUntil: "2027-10-10", nameDeadline: "2027-10-15" }).fareRupees).toBe(9450);
    expect(quoteSchema.safeParse({ airline: "Demo Air", fareRupees: "94.5", validUntil: "2027-10-10", nameDeadline: "2027-10-15" }).success).toBe(false);
    expect(acceptSchema.safeParse({ balanceDueDate: "" }).success).toBe(false);
  });

  it("normalises PNRs", () => {
    expect(pnrSchema.parse(" ab12cd ")).toBe("AB12CD");
    expect(pnrSchema.safeParse("AB-12").success).toBe(false);
  });

  it("sets deadlines to 23:59 IST", () => {
    expect(new Date(endOfDayIST("2027-10-15")).toISOString()).toBe("2027-10-15T18:29:59.000Z");
  });

  it("explains database errors", () => {
    expect(opsErrorMessage("ERROR: BELOW_MINIMUM")).toMatch(/minimum/);
    expect(opsErrorMessage("BALANCES_OUTSTANDING")).toMatch(/Release unpaid/);
    expect(opsErrorMessage("??")).toMatch(/Try again/);
  });
});
