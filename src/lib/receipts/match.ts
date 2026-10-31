import { amountsClose } from "@/lib/money";

export type MatchCandidate = {
  id: string;
  date: string;
  descriptionNormalized: string;
  amountArs: number | null;
  categorySlug?: string | null;
  hasReceipt?: boolean;
};

export type ReceiptSignal = {
  merchantName: string | null;
  receiptDate: string | null; // YYYY-MM-DD
  totalArs: number | null;
};

export type MatchResult = {
  transactionId: string | null;
  score: number;
  reason: string;
  candidates: Array<{ id: string; score: number; reason: string }>;
};

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T12:00:00Z").getTime();
  const db = new Date(b + "T12:00:00Z").getTime();
  return Math.abs(da - db) / (1000 * 60 * 60 * 24);
}

function merchantTokens(s: string): string[] {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9ÁÉÍÓÚÑ ]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function merchantOverlap(a: string, b: string): number {
  const ta = new Set(merchantTokens(a));
  const tb = new Set(merchantTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.max(ta.size, tb.size);
}

/**
 * Score bank transactions against a supermarket receipt.
 * Window: receipt date -1d .. +2d (bank lag).
 */
export function matchReceiptToTransactions(
  receipt: ReceiptSignal,
  txs: MatchCandidate[],
): MatchResult {
  if (receipt.totalArs == null || !receipt.receiptDate) {
    return {
      transactionId: null,
      score: 0,
      reason: "Ticket sin fecha o total",
      candidates: [],
    };
  }

  const scored: Array<{ id: string; score: number; reason: string }> = [];

  for (const tx of txs) {
    if (tx.hasReceipt) continue;
    if (tx.amountArs == null) continue;

    const dayDiff = daysBetween(tx.date, receipt.receiptDate);
    if (dayDiff > 2) continue;

    let score = 0;
    const reasons: string[] = [];

    // Amount
    if (amountsClose(Math.abs(tx.amountArs), Math.abs(receipt.totalArs))) {
      const exact = Math.abs(Math.abs(tx.amountArs) - Math.abs(receipt.totalArs)) < 1;
      score += exact ? 50 : 35;
      reasons.push(exact ? "monto exacto" : "monto similar");
    } else {
      continue; // amount is required
    }

    // Date proximity
    if (dayDiff === 0) {
      score += 25;
      reasons.push("mismo día");
    } else if (dayDiff <= 1) {
      score += 15;
      reasons.push("±1 día");
    } else {
      score += 5;
      reasons.push("±2 días");
    }

    // Merchant / category
    const merchant = receipt.merchantName ?? "";
    if (merchant) {
      const overlap = merchantOverlap(merchant, tx.descriptionNormalized);
      if (overlap >= 0.4) {
        score += 20;
        reasons.push("comercio coincide");
      } else if (
        tx.categorySlug === "supermercado" ||
        tx.categorySlug === "kiosco"
      ) {
        score += 10;
        reasons.push("categoría supermercado");
      }
    } else if (
      tx.categorySlug === "supermercado" ||
      tx.categorySlug === "kiosco"
    ) {
      score += 8;
      reasons.push("categoría supermercado");
    }

    scored.push({ id: tx.id, score, reason: reasons.join(", ") });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (!best || best.score < 50) {
    return {
      transactionId: null,
      score: best?.score ?? 0,
      reason: "Sin match confiable — se creará el gasto",
      candidates: scored.slice(0, 5),
    };
  }

  // Ambiguous if second is close
  if (scored[1] && scored[1].score >= best.score - 5 && scored[1].score >= 50) {
    return {
      transactionId: null,
      score: best.score,
      reason: "Varios candidatos — elegir manualmente",
      candidates: scored.slice(0, 5),
    };
  }

  return {
    transactionId: best.id,
    score: best.score,
    reason: best.reason,
    candidates: scored.slice(0, 5),
  };
}
