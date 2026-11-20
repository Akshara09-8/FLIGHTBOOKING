export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  subscription: "Plan",
  deposit: "Deposit",
  balance: "Fare balance",
  refund: "Refund",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  created: "Waiting for payment",
  succeeded: "Paid",
  failed: "Failed",
  refunded: "Refunded",
};

export function paymentStatusClass(status: string): string {
  if (status === "succeeded") return "text-ok";
  if (status === "failed") return "text-danger";
  return "text-muted";
}

export function formatPaymentDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}
