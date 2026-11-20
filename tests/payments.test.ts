import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { depositTotal, formatRupees, formatRupeesPlain, gstBreakup } from "@/lib/payments/money";
import { verifyCheckoutSignature, verifyWebhookSignature } from "@/lib/payments/signatures";
import { parseRazorpayWebhook } from "@/lib/payments/webhook";
import { gatewayConfig, mockGateway } from "@/lib/payments/gateway";
import { buildReceiptPdf, receiptContent, type ReceiptData } from "@/lib/payments/receipt";

describe("money in paise (T3.9)", () => {
  it("splits GST so base + GST always equals the total", () => {
    expect(gstBreakup(19900)).toEqual({ basePaise: 16864, gstPaise: 3036, totalPaise: 19900 });
    expect(gstBreakup(49900)).toEqual({ basePaise: 42288, gstPaise: 7612, totalPaise: 49900 });
    for (const total of [1, 99, 100, 11800, 123457, 9999999]) {
      const g = gstBreakup(total);
      expect(g.basePaise + g.gstPaise).toBe(total);
      expect(Number.isInteger(g.basePaise) && Number.isInteger(g.gstPaise)).toBe(true);
    }
  });

  it("refuses fractional or negative amounts", () => {
    expect(() => gstBreakup(10.5)).toThrow();
    expect(() => gstBreakup(-1)).toThrow();
  });

  it("deposit + balance add up with no rounding", () => {
    const deposit = depositTotal(3, 150000);
    expect(deposit).toBe(450000);
    const fare = 3 * 945000;
    expect(fare - deposit + deposit).toBe(fare);
    expect(() => depositTotal(0, 150000)).toThrow();
    expect(() => depositTotal(2, 1500.5)).toThrow();
  });

  it("formats rupees", () => {
    expect(formatRupees(19900)).toBe("₹199");
    expect(formatRupees(150050)).toBe("₹1,500.50");
    expect(formatRupeesPlain(12345678)).toBe("Rs. 1,23,456.78");
    expect(formatRupeesPlain(5)).toBe("Rs. 0.05");
  });
});

describe("Razorpay signatures (T3.1, T3.3)", () => {
  const secret = "test_secret_123";

  it("accepts a correct checkout signature and rejects tampering", () => {
    const sig = createHmac("sha256", secret).update("order_ABC|pay_XYZ").digest("hex");
    expect(verifyCheckoutSignature("order_ABC", "pay_XYZ", sig, secret)).toBe(true);
    expect(verifyCheckoutSignature("order_ABC", "pay_OTHER", sig, secret)).toBe(false);
    expect(verifyCheckoutSignature("order_ABC", "pay_XYZ", sig, "wrong")).toBe(false);
    expect(verifyCheckoutSignature("order_ABC", "pay_XYZ", "", secret)).toBe(false);
  });

  it("verifies webhook bodies byte for byte", () => {
    const body = JSON.stringify({ event: "payment.captured" });
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
    expect(verifyWebhookSignature(body + " ", sig, secret)).toBe(false);
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
  });
});

describe("webhook parsing (T3.3, T3.5)", () => {
  const entity = { id: "pay_1", order_id: "order_1", amount: 150000 };

  it("reads captured payments", () => {
    expect(parseRazorpayWebhook({ event: "payment.captured", payload: { payment: { entity } } })).toEqual({
      kind: "captured",
      orderId: "order_1",
      gatewayPaymentId: "pay_1",
      amountPaise: 150000,
    });
  });

  it("reads failures with a reason", () => {
    const r = parseRazorpayWebhook({
      event: "payment.failed",
      payload: { payment: { entity: { ...entity, error_description: "Card declined" } } },
    });
    expect(r).toMatchObject({ kind: "failed", reason: "Card declined" });
  });

  it("ignores other or malformed events", () => {
    expect(parseRazorpayWebhook({ event: "refund.created" }).kind).toBe("ignored");
    expect(parseRazorpayWebhook({ event: "payment.captured", payload: {} }).kind).toBe("ignored");
    expect(
      parseRazorpayWebhook({ event: "payment.captured", payload: { payment: { entity: { ...entity, amount: 1.5 } } } }).kind,
    ).toBe("ignored");
    expect(parseRazorpayWebhook(null).kind).toBe("ignored");
  });
});

describe("gateway settings", () => {
  it("defaults to the built-in test gateway", () => {
    expect(gatewayConfig({} as unknown as NodeJS.ProcessEnv)).toEqual({ name: "mock" });
  });

  it("needs keys for Razorpay and refuses live keys", () => {
    expect(() => gatewayConfig({ PAYMENT_GATEWAY: "razorpay" } as unknown as NodeJS.ProcessEnv)).toThrow(/RAZORPAY_KEY_ID/);
    expect(() =>
      gatewayConfig({
        PAYMENT_GATEWAY: "razorpay",
        RAZORPAY_KEY_ID: "rzp_live_abc",
        RAZORPAY_KEY_SECRET: "x",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/Live Razorpay keys/);
    expect(
      gatewayConfig({ PAYMENT_GATEWAY: "razorpay", RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "x" } as unknown as NodeJS.ProcessEnv),
    ).toMatchObject({ name: "razorpay", keyId: "rzp_test_abc", webhookSecret: null });
  });

  it("mock gateway issues unique order and refund ids", async () => {
    const a = await mockGateway.createOrder({ amountPaise: 100, receipt: "r", notes: {} });
    const b = await mockGateway.createOrder({ amountPaise: 100, receipt: "r", notes: {} });
    expect(a.orderId).toMatch(/^mock_order_/);
    expect(a.orderId).not.toBe(b.orderId);
    expect((await mockGateway.refund({ gatewayPaymentId: "p", amountPaise: 1 })).refundId).toMatch(/^mock_rfnd_/);
  });
});

describe("receipts (T3.8)", () => {
  const base: ReceiptData = {
    paymentId: "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
    type: "subscription",
    status: "succeeded",
    amountPaise: 19900,
    paidAt: "2026-11-20T06:30:00Z",
    planName: "Monthly",
    customerName: "Asha Verma",
    customerEmail: "asha@example.com",
    gatewayRef: "mock_pay_1",
    gateway: "mock",
  };

  it("shows name, amount, GST line and IST date for a plan", () => {
    const c = receiptContent(base);
    expect(c.title).toBe("Payment receipt");
    expect(c.number).toBe("GF-3F2A9C1E5B");
    expect(c.rows).toContainEqual(["Billed to", "Asha Verma, asha@example.com"]);
    expect(c.rows).toContainEqual(["Date", expect.stringMatching(/20 Nov 2026.*12:00 IST/)]);
    expect(c.item).toBe("Monthly plan");
    expect(c.totals).toEqual([
      ["Amount before GST", "Rs. 168.64"],
      ["GST 18%", "Rs. 30.36"],
      ["Total paid", "Rs. 199.00"],
    ]);
    expect(c.notes.join(" ")).toMatch(/no real money/);
  });

  it("has no GST on a refundable deposit and describes the seats", () => {
    const c = receiptContent({
      ...base,
      type: "deposit",
      amountPaise: 300000,
      seats: 2,
      pool: { origin: "DEL", destination: "PAT", travel_date: "2027-10-29" },
    });
    expect(c.item).toBe("Refundable deposit, 2 seats, DEL to PAT, 2027-10-29");
    expect(c.totals).toContainEqual(["Total paid", "Rs. 3,000.00"]);
    expect(c.totals[0][1]).toMatch(/Not applicable/);
  });

  it("describes a fare balance without calling it a deposit", () => {
    const c = receiptContent({ ...base, type: "balance", amountPaise: 2385000, pool: { origin: "DEL", destination: "PAT", travel_date: "2027-10-29" } });
    expect(c.item).toBe("Fare balance, DEL to PAT, 2027-10-29");
    expect(c.totals).toEqual([
      ["Taxes", "Included in the airline fare"],
      ["Total paid", "Rs. 23,850.00"],
    ]);
  });

  it("titles refunds and notes refunded payments", () => {
    expect(receiptContent({ ...base, type: "refund" }).title).toBe("Refund note");
    expect(receiptContent({ ...base, status: "refunded" }).notes[0]).toMatch(/refunded in full/);
  });

  it("produces a one-page PDF", async () => {
    const bytes = await buildReceiptPdf(base);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Payment receipt GF-3F2A9C1E5B");
  });
});
