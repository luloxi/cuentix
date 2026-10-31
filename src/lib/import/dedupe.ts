/** Stable key for “same expense” even if fingerprint algorithm changed. */
export function logicalExpenseKey(m: {
  date: string;
  descriptionNormalized: string;
  amountArs: number | null;
  amountUsd: number | null;
  installment: string | null;
  isPayment?: boolean;
}): string {
  const ars =
    m.amountArs != null && Number.isFinite(m.amountArs)
      ? Math.abs(m.amountArs).toFixed(2)
      : "";
  const usd =
    m.amountUsd != null && Number.isFinite(m.amountUsd)
      ? Math.abs(m.amountUsd).toFixed(2)
      : "";
  return [
    m.date,
    m.descriptionNormalized.trim().toUpperCase(),
    ars,
    usd,
    m.installment ?? "",
    m.isPayment ? "1" : "0",
  ].join("|");
}
