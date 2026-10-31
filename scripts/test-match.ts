import { matchReceiptToTransactions } from "../src/lib/receipts/match";

const result = matchReceiptToTransactions(
  {
    merchantName: "DIA TIENDA 536",
    receiptDate: "2026-06-05",
    totalArs: 30277,
  },
  [
    {
      id: "a",
      date: "2026-06-05",
      descriptionNormalized: "DIA TIENDA 536",
      amountArs: 30277,
      categorySlug: "supermercado",
    },
    {
      id: "b",
      date: "2026-06-05",
      descriptionNormalized: "RAPPI",
      amountArs: 30277,
      categorySlug: "delivery",
    },
    {
      id: "c",
      date: "2026-06-04",
      descriptionNormalized: "DIA TIENDA 536",
      amountArs: 15000,
      categorySlug: "supermercado",
    },
  ],
);

console.log(result);
if (result.transactionId !== "a") {
  console.error("FAIL: expected match a");
  process.exit(1);
}
console.log("OK match");
