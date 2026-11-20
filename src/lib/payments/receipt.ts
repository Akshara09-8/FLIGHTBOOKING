import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatRupeesPlain, gstBreakup, GST_RATE_PERCENT } from "./money";

export type ReceiptData = {
  paymentId: string;
  type: "subscription" | "deposit" | "balance" | "refund";
  status: string;
  amountPaise: number;
  paidAt: string | null;
  planName?: string | null;
  customerName: string | null;
  customerEmail: string | null;
  gatewayRef: string | null;
  gateway: string;
  pool?: { origin: string; destination: string; travel_date: string } | null;
  seats?: number | null;
};

export type ReceiptContent = {
  title: string;
  number: string;
  rows: [string, string][];
  item: string;
  totals: [string, string][];
  notes: string[];
};

function istDate(iso: string | null): string {
  if (!iso) return "-";
  return (
    new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    }).format(new Date(iso)) + " IST"
  );
}

/** Everything printed on a receipt, as plain data (unit-tested, T3.8). */
export function receiptContent(d: ReceiptData): ReceiptContent {
  const number = `GF-${d.paymentId.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const route = d.pool ? `${d.pool.origin} to ${d.pool.destination}, ${d.pool.travel_date}` : "";
  const item =
    d.type === "subscription"
      ? `${d.planName ?? "GroupFly"} plan`
      : d.type === "deposit"
        ? `Refundable deposit, ${d.seats ?? 1} seat${(d.seats ?? 1) > 1 ? "s" : ""}${route ? `, ${route}` : ""}`
        : d.type === "refund"
          ? `Refund of deposit${route ? `, ${route}` : ""}`
          : `Fare balance${route ? `, ${route}` : ""}`;

  let totals: [string, string][];
  if (d.type === "subscription") {
    const g = gstBreakup(d.amountPaise);
    totals = [
      ["Amount before GST", formatRupeesPlain(g.basePaise)],
      [`GST ${GST_RATE_PERCENT}%`, formatRupeesPlain(g.gstPaise)],
      ["Total paid", formatRupeesPlain(g.totalPaise)],
    ];
  } else if (d.type === "refund") {
    totals = [["Total refunded", formatRupeesPlain(d.amountPaise)]];
  } else if (d.type === "balance") {
    totals = [
      ["Taxes", "Included in the airline fare"],
      ["Total paid", formatRupeesPlain(d.amountPaise)],
    ];
  } else {
    totals = [
      ["GST", "Not applicable (refundable deposit)"],
      ["Total paid", formatRupeesPlain(d.amountPaise)],
    ];
  }

  const notes = [
    d.status === "refunded" ? "This payment has been refunded in full." : "",
    // Live gateway keys are blocked in this demo (see gatewayConfig), so every payment is a test.
    d.gateway === "mock" ? "Test mode (built-in test gateway): no real money was charged." : "Test mode: no real money was charged.",
    "Demo receipt. Not a tax invoice.",
  ].filter(Boolean);

  return {
    title: d.type === "refund" ? "Refund note" : "Payment receipt",
    number,
    rows: [
      ["Receipt no.", number],
      ["Date", istDate(d.paidAt)],
      ["Billed to", [d.customerName, d.customerEmail].filter(Boolean).join(", ") || "-"],
      ["Payment reference", d.gatewayRef ?? "-"],
    ],
    item,
    totals,
    notes,
  };
}

export async function buildReceiptPdf(d: ReceiptData): Promise<Uint8Array> {
  const c = receiptContent(d);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${c.title} ${c.number}`);
  pdf.setAuthor("GroupFly");
  const page = pdf.addPage([595, 842]); // A4 in points
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const teal = rgb(0.06, 0.37, 0.39);
  const ink = rgb(0.07, 0.16, 0.17);
  const muted = rgb(0.36, 0.44, 0.45);
  const left = 56;
  const right = 539;
  let y = 780;

  page.drawRectangle({ x: 0, y: 800, width: 595, height: 42, color: teal });
  page.drawText("GroupFly", { x: left, y: 814, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText(c.title, { x: left, y: y - 20, size: 22, font: bold, color: ink });
  y -= 60;

  for (const [label, value] of c.rows) {
    page.drawText(label, { x: left, y, size: 10, font, color: muted });
    page.drawText(value, { x: left + 130, y, size: 11, font, color: ink });
    y -= 20;
  }

  y -= 20;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.75, color: muted });
  y -= 22;
  page.drawText("Item", { x: left, y, size: 10, font: bold, color: muted });
  y -= 18;
  page.drawText(c.item, { x: left, y, size: 11, font, color: ink, maxWidth: right - left });
  y -= 30;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.75, color: muted });
  y -= 22;

  for (const [label, value] of c.totals) {
    const isTotal = label.startsWith("Total");
    const f = isTotal ? bold : font;
    page.drawText(label, { x: left + 250, y, size: 11, font: f, color: ink });
    const w = f.widthOfTextAtSize(value, 11);
    page.drawText(value, { x: right - w, y, size: 11, font: f, color: ink });
    y -= 20;
  }

  y -= 30;
  for (const note of c.notes) {
    page.drawText(note, { x: left, y, size: 9, font, color: muted });
    y -= 14;
  }
  return pdf.save();
}
