/** GST on GroupFly's own service (subscriptions). Deposits are refundable and carry no GST. */
export const GST_RATE_PERCENT = 18;

/** Splits a GST-inclusive amount into base + GST, in whole paise, so the parts always add up. */
export function gstBreakup(totalPaise: number, ratePercent = GST_RATE_PERCENT) {
  if (!Number.isInteger(totalPaise) || totalPaise < 0) throw new Error("Amount must be whole paise");
  const base = Math.round((totalPaise * 100) / (100 + ratePercent));
  return { basePaise: base, gstPaise: totalPaise - base, totalPaise };
}

/** Deposit for a party: seats × per-seat deposit, in paise. */
export function depositTotal(seats: number, depositPaise: number): number {
  if (!Number.isInteger(seats) || seats < 1) throw new Error("Seats must be a positive whole number");
  if (!Number.isInteger(depositPaise) || depositPaise < 0) throw new Error("Deposit must be whole paise");
  return seats * depositPaise;
}

/** "Rs. 1,234.50" — for PDFs, whose built-in fonts have no ₹ sign. */
export function formatRupeesPlain(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = String(abs % 100).padStart(2, "0");
  return `${sign}Rs. ${new Intl.NumberFormat("en-IN").format(rupees)}.${p}`;
}

/** "₹1,234.50" for screens; whole rupees drop the ".00". */
export function formatRupees(paise: number): string {
  const whole = paise % 100 === 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}
